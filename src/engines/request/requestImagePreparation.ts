import { resolveConversationImageMessageIds } from '../conversationWindowSettings';
import { getAssetBlob } from '../../infrastructure/assetStore';
import { requestImageUnderstanding, resolveImageUnderstandingProvider, type ImageUnderstandingRequestReply } from '../imageUnderstandingClient';
import { resolveProviderCapability } from '../provider-runtime';
import type { ChatMessage, ConversationWindowPreferences, ImageUnderstandingSettings, ProviderProfile } from '../../types/domain';
import type { RequestMessage } from './requestMessage';

const REQUEST_IMAGE_MAX_EDGE = 1280;
const REQUEST_IMAGE_SOFT_TARGET_BYTES = 320 * 1024;
const REQUEST_IMAGE_EXPORT_QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42] as const;
const REQUEST_IMAGE_DIRECT_KEEP_MIME_TYPES = new Set(['image/jpeg', 'image/webp']);

export type RequestImageUnderstandingResult = {
  messageId: string;
  attachmentId: string;
  textContent: string;
};
async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    const buffer = await blob.arrayBuffer();
    const base64 = typeof Buffer !== 'undefined'
      ? Buffer.from(buffer).toString('base64')
      : btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return null;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = 'async';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片加载失败'));
      element.src = objectUrl;
    });
    return image;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function shouldKeepOriginalRequestImage(params: {
  blob: Blob;
  mimeType: string;
  scale: number;
}) {
  const { blob, mimeType, scale } = params;
  return (
    scale === 1
    && blob.size <= REQUEST_IMAGE_SOFT_TARGET_BYTES
    && REQUEST_IMAGE_DIRECT_KEEP_MIME_TYPES.has(mimeType)
  );
}

export async function buildRequestImageDataUrl(blob: Blob): Promise<string | null> {
  if (!blob.size) return null;

  const fallbackDataUrl = async () => await blobToDataUrl(blob);
  const mimeType = blob.type.toLowerCase();

  if (
    typeof document === 'undefined'
    || mimeType === 'image/svg+xml'
    || mimeType === 'image/gif'
  ) {
    return await fallbackDataUrl();
  }

  const image = await loadImageFromBlob(blob);
  if (!image) {
    return await fallbackDataUrl();
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return await fallbackDataUrl();
  }

  const scale = Math.min(1, REQUEST_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (shouldKeepOriginalRequestImage({ blob, mimeType, scale })) {
    return await fallbackDataUrl();
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement('canvas');
  } catch {
    return await fallbackDataUrl();
  }
  canvas.width = width;
  canvas.height = height;

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  if (!context) {
    return await fallbackDataUrl();
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let optimizedBlob: Blob | null = null;
  for (const quality of REQUEST_IMAGE_EXPORT_QUALITY_STEPS) {
    const candidate = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!candidate) continue;
    optimizedBlob = candidate;
    if (candidate.size <= REQUEST_IMAGE_SOFT_TARGET_BYTES) break;
  }

  if (!optimizedBlob) {
    return await fallbackDataUrl();
  }

  if (scale === 1 && optimizedBlob.size >= blob.size) {
    return await fallbackDataUrl();
  }

  return await blobToDataUrl(optimizedBlob);
}

export function resolveRequestImageHydrationMessageIds(messages: RequestMessage[], policy?: ConversationWindowPreferences['historicalImagePolicy']): Set<string> {
  return resolveConversationImageMessageIds(messages, policy);
}

/** Policy projection also applies on text/OCR routes, without reading any asset. */
export function omitUnselectedRequestImageBytes(messages: RequestMessage[], policy?: ConversationWindowPreferences['historicalImagePolicy']): RequestMessage[] {
  const admitted = resolveRequestImageHydrationMessageIds(messages, policy);
  return messages.map(message => message.role === 'user' && !admitted.has(message.id) && message.attachments?.some(item => item.kind === 'image' && item.dataUrl)
    ? { ...message, attachments: message.attachments.map(item => item.kind === 'image' ? { ...item, dataUrl: undefined } : item) } : message);
}

export async function hydrateConversationAssets(messages: RequestMessage[], policy?: ConversationWindowPreferences['historicalImagePolicy']): Promise<RequestMessage[]> {
  if (!messages.some((message) => message.role === 'user' && messageContainsImage(message))) {
    return messages;
  }
  const hydratedDataUrlByAssetId = new Map<string, Promise<string | null>>();
  const hydrationMessageIds = resolveRequestImageHydrationMessageIds(messages, policy);

  return await Promise.all(
    messages.map(async (message) => {
      if (message.role === 'user' && !hydrationMessageIds.has(message.id) && message.attachments?.some(item => item.kind === 'image' && item.dataUrl)) {
        return { ...message, attachments: message.attachments.map(item => item.kind === 'image' ? { ...item, dataUrl: undefined } : item) };
      }
      if (
        message.role !== 'user'
        || !hydrationMessageIds.has(message.id)
        || !message.attachments?.some((attachment) => attachment.kind === 'image' && !attachment.clearedAt)
      ) {
        return message;
      }

      let didHydrateImage = false;

      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          if (attachment.kind !== 'image' || attachment.clearedAt) return attachment;
          if (!attachment.assetId) {
            return attachment;
          }
          let dataUrl: string | null = null;
          try {
            const pending =
              hydratedDataUrlByAssetId.get(attachment.assetId)
              ?? (async () => {
                const blob = await getAssetBlob(attachment.assetId);
                if (!blob) return null;
                return await buildRequestImageDataUrl(blob);
              })();
            hydratedDataUrlByAssetId.set(attachment.assetId, pending);
            dataUrl = await pending;
          } catch (error) {
            console.warn(`[request] image hydration skipped for ${attachment.assetId}`, error);
            return attachment;
          }
          if (!dataUrl) return attachment;
          didHydrateImage = true;
          return { ...attachment, dataUrl };
        })
      );

      if (!didHydrateImage) {
        return message;
      }

      return {
        ...message,
        attachments
      };
    })
  );
}

export function messageContainsImage(message: Pick<RequestMessage, 'attachments'> | Pick<ChatMessage, 'attachments'> | undefined): boolean {
  return Boolean(message?.attachments?.some((attachment) => attachment.kind === 'image' && !attachment.clearedAt));
}

export function messageContainsUnreadableImage(message: Pick<RequestMessage, 'attachments'> | Pick<ChatMessage, 'attachments'> | undefined): boolean {
  return Boolean(message?.attachments?.some((attachment) =>
    attachment.kind === 'image'
    && !attachment.clearedAt
    && !attachment.textContent?.trim()
  ));
}

function resolveChatImageUnderstandingMessageIds(messages: ChatMessage[], policy?: ConversationWindowPreferences['historicalImagePolicy']): Set<string> {
  return resolveConversationImageMessageIds(messages, policy);
}

export async function understandConversationImages(params: {
  historicalImagePolicy?: ConversationWindowPreferences['historicalImagePolicy'];
  messages: ChatMessage[];
  settings?: ImageUnderstandingSettings;
  providers?: ProviderProfile[];
  globalApi: ProviderProfile;
  signal?: AbortSignal;
  requestImageUnderstanding?: ImageUnderstandingRequestReply;
}): Promise<{
  messages: ChatMessage[];
  results: RequestImageUnderstandingResult[];
}> {
  const api = resolveImageUnderstandingProvider({
    settings: params.settings,
    providers: params.providers,
    globalApi: params.globalApi
  });
  if (!api) {
    return {
      messages: params.messages,
      results: []
    };
  }
  const providerCapability = resolveProviderCapability(api);
  if (providerCapability.input.images === 'none') {
    console.warn('[request] image understanding skipped because the selected provider does not support image input.');
    return {
      messages: params.messages,
      results: []
    };
  }

  const targetMessageIds = resolveChatImageUnderstandingMessageIds(params.messages, params.historicalImagePolicy);
  if (targetMessageIds.size === 0) {
    return {
      messages: params.messages,
      results: []
    };
  }

  const dataUrlByAssetId = new Map<string, Promise<string | null>>();
  const results: RequestImageUnderstandingResult[] = [];

  const messages = await Promise.all(params.messages.map(async (message) => {
    if (!targetMessageIds.has(message.id) || !message.attachments?.length) return message;

    let didUpdate = false;
    const attachments = await Promise.all(message.attachments.map(async (attachment) => {
      if (
        attachment.kind !== 'image'
        || attachment.clearedAt
        || attachment.textContent?.trim()
        || !attachment.assetId
      ) {
        return attachment;
      }

      try {
        const pending =
          dataUrlByAssetId.get(attachment.assetId)
          ?? (async () => {
            const blob = await getAssetBlob(attachment.assetId);
            if (!blob) return null;
            return await buildRequestImageDataUrl(blob);
          })();
        dataUrlByAssetId.set(attachment.assetId, pending);
        const imageDataUrl = await pending;
        if (!imageDataUrl) return attachment;

        const textContent = await requestImageUnderstanding({
          api,
          imageDataUrl,
          imageName: attachment.name,
          signal: params.signal,
          requestReply: params.requestImageUnderstanding
        });
        didUpdate = true;
        results.push({
          messageId: message.id,
          attachmentId: attachment.id,
          textContent
        });
        return {
          ...attachment,
          textContent
        };
      } catch (error) {
        if (params.signal?.aborted) throw error;
        console.warn(`[request] image understanding skipped for ${attachment.assetId}`, error);
        return attachment;
      }
    }));

    return didUpdate
      ? {
          ...message,
          attachments
        }
      : message;
  }));

  return {
    messages,
    results
  };
}

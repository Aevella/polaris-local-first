import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type NativeProviderHttpEvent = {
  requestId: string;
  type: 'chunk' | 'complete' | 'error';
  data?: string;
  message?: string;
};

type NativeProviderHttpPlugin = {
  start(options: {
    requestId: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{
    status: number;
    contentType?: string;
  }>;
  cancel(options: { requestId: string }): Promise<void>;
  addListener(
    eventName: 'event',
    listener: (event: NativeProviderHttpEvent) => void
  ): Promise<PluginListenerHandle>;
};

const NativeProviderHttp = registerPlugin<NativeProviderHttpPlugin>('NativeProviderHttp');

function createRequestId() {
  return `provider-http-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function decodeBase64Chunk(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

export function canUseNativeProviderHttp() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('NativeProviderHttp')) return false;
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android';
}

export async function executeNativeProviderHttpRequest(args: {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  onResponse: (response: { status: number; contentType: string }) => void;
  onTextChunk: (chunk: string) => void;
}) {
  const requestId = createRequestId();
  const decoder = new TextDecoder();
  const pendingEvents: NativeProviderHttpEvent[] = [];
  let responseReady = false;
  let settled = false;
  let cancelRequested = false;
  let listener: PluginListenerHandle | null = null;
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: Error) => void;
  let rejectAbort!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  void abortPromise.catch(() => undefined);

  const settleWithError = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectCompletion(error);
  };

  const processEvent = (event: NativeProviderHttpEvent) => {
    if (settled) return;
    try {
      if (event.type === 'chunk') {
        if (typeof event.data !== 'string') {
          throw new Error('原生模型网络返回了无效的数据块。');
        }
        const text = decoder.decode(decodeBase64Chunk(event.data), { stream: true });
        if (text) args.onTextChunk(text);
        return;
      }
      if (event.type === 'error') {
        settleWithError(new Error(event.message?.trim() || '原生模型网络请求失败。'));
        return;
      }
      const tail = decoder.decode();
      if (tail) args.onTextChunk(tail);
      settled = true;
      resolveCompletion();
    } catch (error) {
      settleWithError(error instanceof Error ? error : new Error('原生模型网络响应解析失败。'));
    }
  };

  const cancelNativeRequest = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    void NativeProviderHttp.cancel({ requestId }).catch(() => undefined);
  };

  const abortRequest = () => {
    cancelNativeRequest();
    rejectAbort(abortError());
  };

  try {
    listener = await NativeProviderHttp.addListener('event', (event) => {
      if (event.requestId !== requestId) return;
      if (!responseReady) {
        pendingEvents.push(event);
        return;
      }
      processEvent(event);
    });

    if (args.signal?.aborted) throw abortError();
    args.signal?.addEventListener('abort', abortRequest, { once: true });

    const response = await Promise.race([
      NativeProviderHttp.start({
        requestId,
        url: args.url,
        headers: args.headers,
        body: args.body
      }),
      abortPromise
    ]);
    if (args.signal?.aborted) throw abortError();

    args.onResponse({
      status: response.status,
      contentType: response.contentType ?? ''
    });
    responseReady = true;
    pendingEvents.splice(0).forEach(processEvent);
    await Promise.race([completion, abortPromise]);
    return {
      status: response.status,
      contentType: response.contentType ?? ''
    };
  } catch (error) {
    cancelNativeRequest();
    throw error;
  } finally {
    args.signal?.removeEventListener('abort', abortRequest);
    await listener?.remove();
  }
}

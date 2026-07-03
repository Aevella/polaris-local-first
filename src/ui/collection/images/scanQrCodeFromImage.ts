import jsQR from 'jsqr';

const MAX_SCAN_EDGE = 2048;

export type QrCodeScanResult = {
  text: string;
  openUrl: string | null;
};

export type QrCodeScanMessages = {
  loadFailed: string;
  unsupportedEnvironment: string;
  invalidSize: string;
  unsupportedDevice: string;
  notFound: string;
};

function loadImage(src: string, messages: QrCodeScanMessages) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(messages.loadFailed));
    image.src = src;
  });
}

function resolveOpenUrl(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function scanQrCodeFromImage(
  src: string,
  messages: QrCodeScanMessages
): Promise<QrCodeScanResult> {
  if (typeof window === 'undefined') {
    throw new Error(messages.unsupportedEnvironment);
  }

  const image = await loadImage(src, messages);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(messages.invalidSize);
  }

  const scale = Math.min(1, MAX_SCAN_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error(messages.unsupportedDevice);
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  });

  if (!decoded?.data?.trim()) {
    throw new Error(messages.notFound);
  }

  const text = decoded.data.trim();
  return {
    text,
    openUrl: resolveOpenUrl(text)
  };
}

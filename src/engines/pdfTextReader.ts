import { ensurePdfJsRuntimeCompat } from './attachmentPdfRuntimeCompat';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfJsWorkerModule = typeof import('pdfjs-dist/legacy/build/pdf.worker.mjs');
type PdfWorkerUrlModule = typeof import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
type GlobalWithPdfJsWorker = typeof globalThis & {
  pdfjsWorker?: {
    WorkerMessageHandler?: PdfJsWorkerModule['WorkerMessageHandler'];
  };
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let pdfJsWorkerModulePromise: Promise<PdfJsWorkerModule> | null = null;
let pdfWorkerUrlPromise: Promise<PdfWorkerUrlModule> | null = null;

function shouldForceMainThreadPdfWorker() {
  return (
    typeof (Array.prototype as { at?: unknown }).at !== 'function'
    || typeof (Uint8Array.prototype as { at?: unknown }).at !== 'function'
    || typeof (String.prototype as { at?: unknown }).at !== 'function'
    || typeof (globalThis as { structuredClone?: unknown }).structuredClone !== 'function'
  );
}

async function loadPdfWorkerUrl() {
  pdfWorkerUrlPromise ??= import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
  return (await pdfWorkerUrlPromise).default;
}

async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    const shouldForceFakeWorker = shouldForceMainThreadPdfWorker();
    ensurePdfJsRuntimeCompat();
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then(async (pdfjs) => {
        if (shouldForceFakeWorker) {
          pdfJsWorkerModulePromise ??= import('pdfjs-dist/legacy/build/pdf.worker.mjs');
          const workerModule = await pdfJsWorkerModulePromise;
          const runtime = globalThis as GlobalWithPdfJsWorker;
          runtime.pdfjsWorker = {
            ...(runtime.pdfjsWorker ?? {}),
            WorkerMessageHandler: workerModule.WorkerMessageHandler
          };
        }

        if (!shouldForceFakeWorker && !pdfjs.GlobalWorkerOptions.workerSrc && !pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerSrc = await loadPdfWorkerUrl();
        }
        return pdfjs;
      });
  }

  return await pdfJsModulePromise;
}

function normalizePdfChunk(value: string) {
  return value.replace(/\u0000/g, '').replace(/\s+/g, ' ');
}

function shouldInsertPdfSpace(line: string, nextChunk: string) {
  const left = line.charAt(line.length - 1);
  const right = nextChunk[0];
  if (!left || !right) return false;
  if (/\s/.test(left) || /\s/.test(right)) return false;
  if (/[([{/"'“‘-]$/.test(line)) return false;
  if (/^[)\]}.,;:!?/"'”’-]/.test(nextChunk)) return false;
  if (/[\u4e00-\u9fff]$/.test(line) || /^[\u4e00-\u9fff]/.test(nextChunk)) return false;
  return true;
}

function flushPdfLine(target: string[], line: string) {
  const normalized = line.replace(/[ \t]+/g, ' ').trim();
  if (normalized) {
    target.push(normalized);
  }
}

function extractPdfPageText(items: unknown[]) {
  const lines: string[] = [];
  let line = '';
  let lastY: number | null = null;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const chunk = typeof (item as { str?: unknown }).str === 'string'
      ? normalizePdfChunk((item as { str: string }).str)
      : '';
    if (!chunk) continue;

    const transform = Array.isArray((item as { transform?: unknown }).transform)
      ? (item as { transform: unknown[] }).transform
      : null;
    const y = typeof transform?.[5] === 'number' ? transform[5] : null;
    const hasEol = Boolean((item as { hasEOL?: unknown }).hasEOL);

    if (line && y !== null && lastY !== null && Math.abs(y - lastY) > 2.5) {
      flushPdfLine(lines, line);
      line = '';
    }

    if (line && shouldInsertPdfSpace(line, chunk)) {
      line += ' ';
    }
    line += chunk;
    lastY = y ?? lastY;

    if (hasEol) {
      flushPdfLine(lines, line);
      line = '';
      lastY = null;
    }
  }

  flushPdfLine(lines, line);
  return lines.join('\n').trim();
}

export async function readPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false
  });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const pageText = extractPdfPageText(textContent.items as unknown[]);
        if (pageText) {
          pages.push(pageText);
        }
      } finally {
        page.cleanup();
      }
    }

    return pages.join('\n\n').trim();
  } finally {
    await loadingTask.destroy();
  }
}

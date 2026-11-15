import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createStoredAttachmentMock,
  getDocumentMock,
  globalWorkerOptions
} = vi.hoisted(() => ({
  createStoredAttachmentMock: vi.fn(async (params: {
    kind: 'file';
    name: string;
    mimeType: string;
    blob: Blob;
    textContent?: string;
  }) => ({
    id: 'attachment-1',
    assetId: 'asset-1',
    kind: params.kind,
    name: params.name,
    mimeType: params.mimeType,
    size: params.blob.size,
    textContent: params.textContent
  })),
  getDocumentMock: vi.fn(),
  globalWorkerOptions: {
    workerSrc: '',
    workerPort: null as Worker | null
  }
}));

vi.mock('../infrastructure/assetStore', () => ({
  createStoredAttachment: createStoredAttachmentMock
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({
  default: '/mock-pdf.worker.mjs'
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: globalWorkerOptions
}));

import { readDocumentAttachment } from './attachmentDocumentReaders';

describe('readDocumentAttachment', () => {
  beforeEach(() => {
    createStoredAttachmentMock.mockClear();
    getDocumentMock.mockReset();
    globalWorkerOptions.workerSrc = '';
    globalWorkerOptions.workerPort = null;
  });

  it('extracts PDF text with pdfjs and stores it as attachment text', async () => {
    const destroy = vi.fn(async () => {});
    const pageCleanup = vi.fn();
    getDocumentMock.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async (pageNumber: number) => ({
          getTextContent: vi.fn(async () => ({
            items: pageNumber === 1
              ? [
                  { str: '第一页', transform: [0, 0, 0, 0, 0, 120], hasEOL: false },
                  { str: '内容', transform: [0, 0, 0, 0, 20, 120], hasEOL: true }
                ]
              : [
                  { str: 'Second', transform: [0, 0, 0, 0, 0, 90], hasEOL: false },
                  { str: 'page', transform: [0, 0, 0, 0, 15, 90], hasEOL: false },
                  { str: 'text', transform: [0, 0, 0, 0, 30, 90], hasEOL: true }
                ]
          })),
          cleanup: pageCleanup
        })),
        destroy
      })
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'sample.pdf', { type: 'application/pdf' });
    const result = await readDocumentAttachment({
      file,
      buffer: new Uint8Array([1, 2, 3]).buffer
    });

    expect(globalWorkerOptions.workerSrc).toBe('/mock-pdf.worker.mjs');
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(createStoredAttachmentMock).toHaveBeenCalledTimes(1);
    expect(pageCleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(result?.textContent).toContain('已从 PDF 中提取可读文字');
    expect(result?.textContent).toContain('第一页内容');
    expect(result?.textContent).toContain('Second page text');
  });

  it('returns null when pdfjs finds no readable text', async () => {
    const destroy = vi.fn(async () => {});
    getDocumentMock.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getTextContent: vi.fn(async () => ({
            items: []
          })),
          cleanup: vi.fn()
        })),
        destroy
      })
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'empty.pdf', { type: 'application/pdf' });
    const result = await readDocumentAttachment({
      file,
      buffer: new Uint8Array([1, 2, 3]).buffer
    });

    expect(result).toBeNull();
    expect(createStoredAttachmentMock).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

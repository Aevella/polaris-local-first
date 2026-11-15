import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const {
  getDocumentMock,
  globalWorkerOptions
} = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
  globalWorkerOptions: {
    workerSrc: '',
    workerPort: null as Worker | null
  }
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({
  default: '/mock-pdf.worker.mjs'
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: globalWorkerOptions
}));

import { importMemoryReferenceDocFromFile } from './memoryReferenceDocImport';

describe('importMemoryReferenceDocFromFile', () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
    globalWorkerOptions.workerSrc = '';
    globalWorkerOptions.workerPort = null;
  });

  it('imports plain text as a long-term memory reference doc draft', async () => {
    const file = new File(['第一段资料\n第二段资料'], '关系边界.md', { type: 'text/markdown' });

    await expect(importMemoryReferenceDocFromFile(file)).resolves.toEqual({
      title: '关系边界',
      summary: '第一段资料 第二段资料',
      content: '第一段资料\n第二段资料'
    });
  });

  it('extracts text from docx document xml', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:r><w:t>第一段</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>第二段 &amp; 边界</w:t></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''));
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], '灯塔资料.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    const draft = await importMemoryReferenceDocFromFile(file);

    expect(draft.title).toBe('灯塔资料');
    expect(draft.content).toBe('第一段\n第二段 & 边界');
    expect(draft.summary).toBe('第一段 第二段 & 边界');
  });

  it('extracts PDF text through the shared pdfjs worker runtime', async () => {
    const destroy = vi.fn(async () => {});
    const cleanup = vi.fn();
    getDocumentMock.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getTextContent: vi.fn(async () => ({
            items: [
              { str: '第一段', transform: [0, 0, 0, 0, 0, 120], hasEOL: false },
              { str: 'PDF资料', transform: [0, 0, 0, 0, 20, 120], hasEOL: true }
            ]
          })),
          cleanup
        })),
        destroy
      })
    });

    const file = new File([new Uint8Array([1, 2, 3])], '棉花糖.pdf', { type: 'application/pdf' });
    const draft = await importMemoryReferenceDocFromFile(file);

    expect(globalWorkerOptions.workerSrc).toBe('/mock-pdf.worker.mjs');
    expect(draft.title).toBe('棉花糖');
    expect(draft.content).toBe('第一段PDF资料');
    expect(draft.summary).toBe('第一段PDF资料');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported binary uploads', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'archive.zip', { type: 'application/zip' });

    await expect(importMemoryReferenceDocFromFile(file)).rejects.toThrow('不支持读取这种文档');
  });
});

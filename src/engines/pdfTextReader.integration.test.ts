import { describe, expect, it } from 'vitest';
import { readPdfText } from './pdfTextReader';

function syntheticPdf() {
  const content = 'BT /F1 12 Tf 10 100 Td (Synthetic PDF text) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer;
}

describe('readPdfText with the installed PDF.js runtime', () => {
  it('extracts a synthetic document using the real library and worker', async () => {
    expect(await readPdfText(syntheticPdf())).toContain('Synthetic PDF text');
  });
});

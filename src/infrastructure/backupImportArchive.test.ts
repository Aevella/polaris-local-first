import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBackupImportArchive } from './backupImportArchive';
import {
  readBackupImportSourceBytes,
  readBackupImportSourcePrefix,
  type NativeBackupImportSource
} from './backupImportSource';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function buildZipBytes() {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: 'polaris-export', version: 1 }));
  zip.file('assets/example.txt', 'range-backed entry');
  const padding = new Uint8Array(256 * 1024);
  let state = 0x12345678;
  for (let index = 0; index < padding.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    padding[index] = state & 0xff;
  }
  zip.file('assets/padding.bin', padding);
  return new Uint8Array(await (await zip.generateAsync({ type: 'blob', compression: 'STORE' })).arrayBuffer());
}

function createNativeSource(bytes: Uint8Array, name = 'polaris-export.zip') {
  const reads: Array<{ start: number; length: number }> = [];
  const release = vi.fn(async () => undefined);
  const source: NativeBackupImportSource = {
    kind: 'native-file',
    name,
    mimeType: 'application/zip',
    size: bytes.length,
    async readRange(start, length) {
      reads.push({ start, length });
      return bytes.slice(start, start + length);
    },
    release
  };
  return { source, reads, release };
}

describe('native backup range reading', () => {
  it('opens and reads a native ZIP through explicit chunks instead of a whole-file fetch', async () => {
    const bytes = await buildZipBytes();
    const { source, reads } = createNativeSource(bytes);

    const archive = await openBackupImportArchive(source);
    try {
      expect(archive.size).toBe(bytes.length);
      expect(await archive.file('assets/example.txt')?.async('string')).toBe('range-backed entry');
    } finally {
      await archive.close();
    }

    expect(reads.length).toBeGreaterThan(1);
    expect(reads.every((read) => read.start >= 0 && read.length > 0)).toBe(true);
    expect(reads.every((read) => read.length < bytes.length)).toBe(true);
  });

  it('recognizes a native ZIP from only its first four bytes', async () => {
    const bytes = await buildZipBytes();
    const { source, reads } = createNativeSource(bytes, 'kelivo.zip');

    const prefix = await readBackupImportSourcePrefix(source, 4);

    expect(Array.from(prefix)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(reads).toEqual([{ start: 0, length: 4 }]);
  });

  it('reassembles a native database source from bounded chunks', async () => {
    const bytes = new Uint8Array(300_000).map((_, index) => index % 251);
    const { source, reads } = createNativeSource(bytes, 'kelivo.db');

    const restored = await readBackupImportSourceBytes(source);

    expect(restored).toEqual(bytes);
    expect(reads).toEqual([
      { start: 0, length: 256 * 1024 },
      { start: 256 * 1024, length: bytes.length - (256 * 1024) }
    ]);
  });
});

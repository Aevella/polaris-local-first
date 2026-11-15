import { describe, it, expect, vi } from 'vitest';
import {
  readBackupImportSourceBytes,
  readBackupImportSourceText,
  type NativeBackupImportSource
} from './backupImportSource';

function nativeSource(bytes: Uint8Array, shortRead = Infinity): NativeBackupImportSource {
  return {
    kind: 'native-file', name: 'synthetic.json', mimeType: 'application/json', size: bytes.length,
    readRange: vi.fn(async (start, length) => bytes.slice(start, start + Math.min(length, shortRead))),
    release: vi.fn(async () => {})
  };
}

describe('readBackupImportSourceText', () => {
  it('decodes UTF-8 characters split across native chunk boundaries without changing JSON', async () => {
    const text = '{"text":"' + ' '.repeat(256 * 1024 - 10) + '中文🙂保留原文"}';
    const source = nativeSource(new TextEncoder().encode(text));
    expect(await readBackupImportSourceText(source)).toBe(text);
    expect(source.readRange).toHaveBeenCalledTimes(2);
  });

  it('handles short native reads, BOM, empty files and incomplete UTF-8 like TextDecoder', async () => {
    const bytes = new TextEncoder().encode('\uFEFF中文🙂');
    expect(await readBackupImportSourceText(nativeSource(bytes, 1))).toBe(new TextDecoder().decode(bytes));
    expect(await readBackupImportSourceText(nativeSource(new Uint8Array()))).toBe('');
    const incomplete = Uint8Array.from([0xe4, 0xb8]);
    expect(await readBackupImportSourceText(nativeSource(incomplete, 1))).toBe(new TextDecoder().decode(incomplete));
  });

  it('preserves the browser Blob path', async () => {
    expect(await readBackupImportSourceText(new Blob(['中文🙂']))).toBe('中文🙂');
  });
});

describe('readBackupImportSourceBytes', () => {
  it('assembles native bytes exactly across multiple and short reads', async () => {
    const bytes = Uint8Array.from({ length: 600000 }, (_, i) => i % 256);
    expect(await readBackupImportSourceBytes(nativeSource(bytes))).toEqual(bytes);
    expect(await readBackupImportSourceBytes(nativeSource(bytes, 100000))).toEqual(bytes);
  });

  it('preserves browser bytes and empty native input', async () => {
    expect(await readBackupImportSourceBytes(new Blob(['abc']))).toEqual(new TextEncoder().encode('abc'));
    expect(await readBackupImportSourceBytes(nativeSource(new Uint8Array()))).toEqual(new Uint8Array());
  });
});

describe('native import read failures', () => {
  it.each([readBackupImportSourceText, readBackupImportSourceBytes])('rejects truncated files instead of accepting partial data', async read => {
    const source = nativeSource(new Uint8Array([1, 2]));
    source.size = 3;
    await expect(read(source)).rejects.toThrow('提前结束');
  });

  it.each([readBackupImportSourceText, readBackupImportSourceBytes])('rejects a bridge returning bytes beyond the requested range', async read => {
    const source = nativeSource(new Uint8Array([1]));
    source.readRange = async () => new Uint8Array([1, 2]);
    await expect(read(source)).rejects.toThrow('读取范围');
  });
});

import { Blob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashDriveBlob } from './drive-hash-core';

describe('incremental drive hashing', () => {
  it('matches SHA-256 for empty and ordinary files', async () => {
    for (const text of ['', 'abc', '\u9879\u76ee\u8d44\u6599']) {
      expect(await hashDriveBlob(new Blob([text]))).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });
  it('reads bounded slices rather than materializing the whole file', async () => {
    const source = new Blob([new Uint8Array(9 * 1024 * 1024).fill(42)]);
    const sizes: number[] = [];
    const progress: number[] = [];
    const hash = await hashDriveBlob({
      size: source.size,
      slice: (start, end) => { sizes.push(end - start); return source.slice(start, end); },
    }, (value) => progress.push(value));
    expect(sizes).toEqual([4 * 1024 * 1024, 4 * 1024 * 1024, 1024 * 1024]);
    expect(hash).toBe(createHash('sha256').update(new Uint8Array(9 * 1024 * 1024).fill(42)).digest('hex'));
    expect(progress.at(-1)).toBe(100);
  });
});

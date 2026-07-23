import { describe, expect, it } from 'vitest';
import { streamByDescendingId } from './cursor-stream';

describe('export cursor stream', () => {
  it('streams the complete result beyond the previous 50k ceiling', async () => {
    const source = Array.from({ length: 50_123 }, (_, index) => ({ id: 50_123 - index }));
    const output: number[] = [];
    for await (const row of streamByDescendingId(async (beforeId, limit) =>
      source.filter((item) => beforeId === null || item.id < beforeId).slice(0, limit), 733)) {
      output.push(row.id);
    }
    expect(output).toHaveLength(source.length);
    expect(output[0]).toBe(50_123);
    expect(output.at(-1)).toBe(1);
  });

  it('fails instead of looping or silently truncating on a broken cursor query', async () => {
    const stream = streamByDescendingId(async () => [{ id: 3 }], 1);
    await expect((async () => {
      for await (const _row of stream) {
        // consume
      }
    })()).rejects.toThrow(/游标未向前推进/);
  });
});

import { createSHA256 } from 'hash-wasm';

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export async function hashDriveBlob(
  blob: { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } },
  progress?: (percent: number) => void,
): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  for (let offset = 0; offset < blob.size; offset += HASH_CHUNK_BYTES) {
    const end = Math.min(offset + HASH_CHUNK_BYTES, blob.size);
    hash.update(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
    progress?.(Math.floor(end / blob.size * 100));
  }
  return hash.digest('hex');
}

import { createSHA256 } from 'hash-wasm';

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

async function hashInMainThread(file: File, signal?: AbortSignal): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError');
    const end = Math.min(offset + HASH_CHUNK_BYTES, file.size);
    hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
  }
  return hash.digest('hex');
}

/**
 * 流式计算整文件 SHA-256。浏览器支持 Worker 时放到 Worker，避免大文件长时间占用主线程；
 * 测试 / 非浏览器环境自动回退到主线程实现。
 */
export function hashFileSha256(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException('上传已取消', 'AbortError'));
  if (typeof Worker === 'undefined' || import.meta.env.MODE === 'test') return hashInMainThread(file, signal);

  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./file-hash.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      void hashInMainThread(file, signal).then(resolve, reject);
      return;
    }
    let settled = false;
    const finish = (error: Error | null, hash?: string) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(hash!);
    };
    const fallbackToMainThread = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      void hashInMainThread(file, signal).then(resolve, reject);
    };
    const onAbort = () => finish(new DOMException('上传已取消', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<string>) => {
      const message = event.data;
      if (message.startsWith('__error__:')) {
        fallbackToMainThread();
        return;
      }
      finish(null, message);
    };
    worker.onerror = fallbackToMainThread;
    worker.postMessage(file);
  });
}

export function hashDriveFile(file: File, signal: AbortSignal, progress: (percent: number) => void): Promise<string> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./drive-hash.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('上传已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { finish(); reject(new Error(event.message || '文件摘要计算失败')); };
    worker.onmessage = (event: MessageEvent<{ percent?: number; hash?: string; error?: string }>) => {
      if (event.data.error) { finish(); reject(new Error(event.data.error)); }
      else if (event.data.hash) { finish(); resolve(event.data.hash); }
      else if (event.data.percent !== undefined) progress(event.data.percent);
    };
    worker.postMessage(file);
  });
}

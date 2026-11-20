import { createSHA256 } from 'hash-wasm';

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<File>) => void) | null;
  postMessage: (message: string) => void;
};

workerSelf.onmessage = async (event) => {
  try {
    const file = event.data;
    const hash = await createSHA256();
    hash.init();
    const bytesPerChunk = 4 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += bytesPerChunk) {
      const end = Math.min(offset + bytesPerChunk, file.size);
      hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    }
    workerSelf.postMessage(hash.digest('hex'));
  } catch (error) {
    workerSelf.postMessage(`__error__:${error instanceof Error ? error.message : String(error)}`);
  }
};

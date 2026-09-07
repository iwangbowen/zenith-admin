import { hashDriveBlob } from './drive-hash-core';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const hash = await hashDriveBlob(event.data, (percent) => self.postMessage({ percent }));
    self.postMessage({ hash });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '文件摘要计算失败' });
  }
};

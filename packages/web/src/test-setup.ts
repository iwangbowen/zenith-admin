import { createRequire, Module } from 'node:module';
import { configure } from '@testing-library/react';

// 保留 Hook / 查询缓存测试的异步观察窗口，与工作区超时设置一致。
configure({ asyncUtilTimeout: 5_000 });

// Semi 的 CommonJS 聚合入口会导入 Lottie。隔离动画模块的导入期画布副作用；
// 如果测试实际启动动画则直接失败，不再通过模拟 DOM / Canvas 支持 UI 测试。
const require = createRequire(import.meta.url);
const lottiePath = require.resolve('lottie-web');
const lottieModule = new Module(lottiePath);
lottieModule.loaded = true;
lottieModule.exports = {
  loadAnimation: () => { throw new Error('单元测试不执行 UI 动画'); },
};
require.cache[lottiePath] = lottieModule;

// 解码器模块加载时会创建 Worker；保留传输替身，不模拟业务控件。
class WorkerStub implements Partial<Worker> {
  onmessage = null;
  onmessageerror = null;
  onerror = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return false; }
}
window.Worker = WorkerStub as unknown as typeof Worker;
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:stub';
  URL.revokeObjectURL = () => {};
}

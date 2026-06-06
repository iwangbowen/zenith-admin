import { contextBridge, ipcRenderer } from 'electron';

/**
 * 通过 contextBridge 暴露安全的窗口控制 API 到渲染进程
 * 渲染进程通过 window.electronAPI.xxx() 调用
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** 最小化窗口 */
  minimize: () => ipcRenderer.send('window:minimize'),
  /** 最大化 / 还原窗口 */
  maximize: () => ipcRenderer.send('window:maximize'),
  /** 关闭窗口 */
  close: () => ipcRenderer.send('window:close'),
  /** 监听窗口最大化状态变化 */
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window:maximized', (_event: Electron.IpcRendererEvent, val: boolean) => callback(val));
    return () => ipcRenderer.removeAllListeners('window:maximized');
  },
  /** 是否在 Electron 环境中运行 */
  isElectron: true,
});

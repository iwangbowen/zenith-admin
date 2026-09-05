/**
 * 演示模式下的宿主机文件 / 终端录屏 / 日志文件替身。
 * 真实文件系统不可访问，这里提供最小虚拟目录树与空列表，写操作一律拒绝。
 */
import { HttpResponse } from 'msw';
import {
  logFileContract,
  terminalFileContract,
  terminalRecordingContract,
  type FsEntry,
} from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { forbidden, notFound } from '@/mocks/utils/handlers';

function demoErr() {
  return forbidden('演示模式下不支持文件操作', { status: 403 });
}

const DEMO_HOME = '/home/demo';

const ROOT_ENTRIES: FsEntry[] = [
  { name: 'home',  path: '/home',  type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
  { name: 'etc',   path: '/etc',   type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
  { name: 'tmp',   path: '/tmp',   type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxrwxrwt' },
  { name: 'var',   path: '/var',   type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
];

const HOME_ENTRIES: FsEntry[] = [
  { name: 'demo', path: DEMO_HOME, type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
];

const DEMO_ENTRIES: FsEntry[] = [
  { name: 'documents', path: `${DEMO_HOME}/documents`, type: 'dir',  size: 0,    mtime: '2024-01-10 09:00:00', permissions: 'drwxr-xr-x' },
  { name: 'downloads', path: `${DEMO_HOME}/downloads`, type: 'dir',  size: 0,    mtime: '2024-01-10 09:00:00', permissions: 'drwxr-xr-x' },
  { name: 'logs',      path: `${DEMO_HOME}/logs`,      type: 'dir',  size: 0,    mtime: '2024-03-15 14:20:00', permissions: 'drwxr-xr-x' },
  { name: 'README.md', path: `${DEMO_HOME}/README.md`, type: 'file', size: 1280, mtime: '2024-01-01 08:00:00', permissions: '-rw-r--r--' },
  { name: '.bashrc',   path: `${DEMO_HOME}/.bashrc`,   type: 'file', size: 3517, mtime: '2024-01-01 08:00:00', permissions: '-rw-r--r--' },
];

export const terminalFilesHandlers = [
  // 获取根目录信息 — 页面初始化时调用
  mock(terminalFileContract.rootInfo, ({ ok }) => ok({ home: DEMO_HOME, isWindows: false, drives: [] })),

  // 列目录
  mock(terminalFileContract.list, ({ query, ok }) => {
    const reqPath = (query.path ?? '/').replace(/\/+$/, '') || '/';

    if (reqPath === '/') {
      return ok({ path: '/', parent: null, entries: ROOT_ENTRIES });
    }
    if (reqPath === '/home') {
      return ok({ path: '/home', parent: '/', entries: HOME_ENTRIES });
    }
    if (reqPath === DEMO_HOME) {
      return ok({ path: DEMO_HOME, parent: '/home', entries: DEMO_ENTRIES });
    }

    // 其余子目录返回空列表
    const parent = reqPath.split('/').slice(0, -1).join('/') || '/';
    return ok({ path: reqPath, parent, entries: [] });
  }),

  // 所有写操作在演示模式下均拒绝
  mock(terminalFileContract.remove, demoErr),
  mock(terminalFileContract.rename, demoErr),
  mock(terminalFileContract.create, demoErr),
  mock(terminalFileContract.move, demoErr),
  mock(terminalFileContract.copy, demoErr),
  mock(terminalFileContract.compress, demoErr),
  mock(terminalFileContract.chmod, demoErr),

  // 上传
  mock(terminalFileContract.upload, demoErr),

  // ── 终端录屏（演示模式返回空列表）─────────────────────────────────────────
  mock(terminalRecordingContract.list, ({ ok, paginate }) => ok(paginate([]))),

  mock(terminalRecordingContract.detail, () => notFound('录屏记录不存在', { status: 404 })),

  mock(terminalRecordingContract.asciinema, () => {
    const content = `${JSON.stringify({ version: 2, width: 80, height: 24, title: 'Demo recording' })}\n`;
    return new HttpResponse(content, {
      headers: {
        'Content-Type': 'application/x-asciicast; charset=utf-8',
        'Content-Disposition': 'attachment; filename="terminal-recording-demo.cast"',
      },
    });
  }),

  mock(terminalRecordingContract.clean, () => forbidden('演示模式下不支持清理录屏', { status: 403 })),

  mock(terminalRecordingContract.remove, () => forbidden('演示模式下不支持删除录屏', { status: 403 })),

  // ── 日志文件（演示模式返回空列表）────────────────────────────────────────
  mock(logFileContract.list, ({ ok }) => ok([])),

  mock(logFileContract.content, ({ ok }) => ok({ lines: ['[INFO] 演示模式：日志内容不可访问'] })),

  mock(logFileContract.remove, () => forbidden('演示模式下不支持删除日志', { status: 403 })),
];

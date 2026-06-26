/**
 * MSW handler for /api/terminal-files/* and /api/terminal-recordings/*
 *
 * In demo mode, the real filesystem is not accessible.
 * These handlers provide minimal virtual filesystem and empty recordings
 * so the pages can load without triggering a 401 that causes a hard logout.
 */
import { http, HttpResponse } from 'msw';

function ok<T>(data: T) {
  return HttpResponse.json({ code: 0, message: 'ok', data });
}

function demoErr() {
  return HttpResponse.json({ code: 403, message: '演示模式下不支持文件操作', data: null }, { status: 403 });
}

const DEMO_HOME = '/home/demo';

const ROOT_ENTRIES = [
  { name: 'home',  path: '/home',  type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
  { name: 'etc',   path: '/etc',   type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
  { name: 'tmp',   path: '/tmp',   type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxrwxrwt' },
  { name: 'var',   path: '/var',   type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
];

const HOME_ENTRIES = [
  { name: 'demo', path: DEMO_HOME, type: 'dir', size: 0, mtime: '2024-01-01 08:00:00', permissions: 'drwxr-xr-x' },
];

const DEMO_ENTRIES = [
  { name: 'documents', path: `${DEMO_HOME}/documents`, type: 'dir',  size: 0,    mtime: '2024-01-10 09:00:00', permissions: 'drwxr-xr-x' },
  { name: 'downloads', path: `${DEMO_HOME}/downloads`, type: 'dir',  size: 0,    mtime: '2024-01-10 09:00:00', permissions: 'drwxr-xr-x' },
  { name: 'logs',      path: `${DEMO_HOME}/logs`,      type: 'dir',  size: 0,    mtime: '2024-03-15 14:20:00', permissions: 'drwxr-xr-x' },
  { name: 'README.md', path: `${DEMO_HOME}/README.md`, type: 'file', size: 1280, mtime: '2024-01-01 08:00:00', permissions: '-rw-r--r--' },
  { name: '.bashrc',   path: `${DEMO_HOME}/.bashrc`,   type: 'file', size: 3517, mtime: '2024-01-01 08:00:00', permissions: '-rw-r--r--' },
];

export const terminalFilesHandlers = [
  // 获取根目录信息 — 页面初始化时调用
  http.get('/api/terminal-files/root-info', () => {
    return ok({ home: DEMO_HOME, isWindows: false, drives: [] });
  }),

  // 列目录
  http.get('/api/terminal-files/list', ({ request }) => {
    const url = new URL(request.url);
    const reqPath = (url.searchParams.get('path') ?? '/').replace(/\/+$/, '') || '/';

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
  http.delete('/api/terminal-files/entry', demoErr),
  http.post('/api/terminal-files/rename', demoErr),
  http.post('/api/terminal-files/create', demoErr),
  http.post('/api/terminal-files/move', demoErr),
  http.post('/api/terminal-files/copy', demoErr),
  http.post('/api/terminal-files/compress', demoErr),
  http.post('/api/terminal-files/chmod', demoErr),

  // 上传
  http.post('/api/terminal-files/upload', demoErr),

  // ── 终端录屏（演示模式返回空列表）─────────────────────────────────────────
  http.get('/api/terminal-recordings', ({ request: req }) => {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: [], total: 0, page, pageSize } });
  }),

  http.get('/api/terminal-recordings/:id', () => {
    return HttpResponse.json({ code: 404, message: '录屏记录不存在', data: null }, { status: 404 });
  }),

  http.get('/api/terminal-recordings/:id/asciinema', () => {
    const content = `${JSON.stringify({ version: 2, width: 80, height: 24, title: 'Demo recording' })}\n`;
    return new HttpResponse(content, {
      headers: {
        'Content-Type': 'application/x-asciicast; charset=utf-8',
        'Content-Disposition': 'attachment; filename="terminal-recording-demo.cast"',
      },
    });
  }),

  http.delete('/api/terminal-recordings/:id', () => {
    return HttpResponse.json({ code: 403, message: '演示模式下不支持删除录屏', data: null }, { status: 403 });
  }),

  http.delete('/api/terminal-recordings/clean', () => {
    return HttpResponse.json({ code: 403, message: '演示模式下不支持清理录屏', data: null }, { status: 403 });
  }),

  // ── 日志文件（演示模式返回空列表）────────────────────────────────────────
  http.get('/api/log-files', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: [] });
  }),

  http.get('/api/log-files/:name/content', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: { lines: ['[INFO] 演示模式：日志内容不可访问'] } });
  }),

  http.delete('/api/log-files/:name', () => {
    return HttpResponse.json({ code: 403, message: '演示模式下不支持删除日志', data: null }, { status: 403 });
  }),
];

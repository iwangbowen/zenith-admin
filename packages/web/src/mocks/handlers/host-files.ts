import { HttpResponse } from 'msw';
import { hostFileContract, type SftpFileEntry } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { removeWhere } from '@/mocks/utils/array';
import { mockDateTime } from '@/mocks/utils/date';
import { badRequest, notFound } from '@/mocks/utils/handlers';

const HOME = '/home/ops';

/** 目录项 + 演示用文件正文（正文不随目录列表下发） */
type Entry = SftpFileEntry & { content?: string };

const entriesByHost = new Map<number, Entry[]>();

function hostEntries(hostId: number): Entry[] {
  let entries = entriesByHost.get(hostId);
  if (!entries) {
    entries = [
      { name: 'logs', path: `${HOME}/logs`, type: 'dir', size: 0, mtime: mockDateTime(), permissions: 'rwxr-xr-x' },
      { name: 'deploy.sh', path: `${HOME}/deploy.sh`, type: 'file', size: 34, mtime: mockDateTime(), permissions: 'rwxr-xr-x', content: `#!/bin/sh\necho "demo deploy on host ${hostId}"\n` },
      { name: 'app.log', path: `${HOME}/logs/app.log`, type: 'file', size: 26, mtime: mockDateTime(), permissions: 'rw-r--r--', content: `INFO demo host ${hostId} is healthy\n` },
    ];
    entriesByHost.set(hostId, entries);
  }
  return entries;
}

function parent(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function toEntry({ content: _content, ...entry }: Entry): SftpFileEntry {
  return entry;
}

export const hostFileHandlers = [
  mock(hostFileContract.home, ({ ok }) => ok({ home: HOME })),
  mock(hostFileContract.list, ({ params, query, ok }) => {
    const entries = hostEntries(params.hostId);
    const path = query.path || HOME;
    const list = entries.filter((entry) => parent(entry.path) === path).map(toEntry);
    return ok({ path, parent: path === '/' ? null : parent(path), entries: list });
  }),
  mock(hostFileContract.content, ({ params, query, ok }) => {
    const entry = hostEntries(params.hostId).find((item) => item.path === query.path && item.type === 'file');
    return entry
      ? ok({ path: query.path, content: entry.content ?? '', size: entry.size, etag: `demo-${entry.mtime}-${entry.size}` })
      : notFound('文件不存在', { status: 404 });
  }),
  mock(hostFileContract.saveContent, ({ params, body, ok }) => {
    const entry = hostEntries(params.hostId).find((item) => item.path === body.path);
    if (!entry) return notFound('文件不存在', { status: 404 });
    entry.content = body.content;
    entry.size = new TextEncoder().encode(body.content).length;
    entry.mtime = mockDateTime();
    return ok(toEntry(entry));
  }),
  mock(hostFileContract.create, ({ params, body, ok }) => {
    const entry: Entry = {
      name: body.path.split('/').pop() ?? body.path,
      path: body.path,
      type: body.type,
      size: 0,
      mtime: mockDateTime(),
      permissions: body.type === 'dir' ? 'rwxr-xr-x' : 'rw-r--r--',
      ...(body.type === 'file' ? { content: '' } : {}),
    };
    hostEntries(params.hostId).push(entry);
    return ok(toEntry(entry));
  }),
  mock(hostFileContract.rename, ({ params, body, ok }) => {
    const entry = hostEntries(params.hostId).find((item) => item.path === body.from);
    if (!entry) return notFound('文件不存在', { status: 404 });
    entry.path = body.to;
    entry.name = body.to.split('/').pop() ?? body.to;
    return ok(toEntry(entry));
  }),
  mock(hostFileContract.chmod, ({ ok }) => ok(null)),
  mock(hostFileContract.download, ({ params, query }) => {
    const entry = hostEntries(params.hostId).find((item) => item.path === query.path && item.type === 'file');
    return entry
      ? new HttpResponse(entry.content ?? '', {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      : notFound('文件不存在', { status: 404 });
  }),
  mock(hostFileContract.upload, async ({ params, body, ok }) => {
    const dir = String(body.get('path') ?? HOME);
    const file = body.get('file');
    if (!(file instanceof File)) return badRequest('未选择文件');
    const entry: Entry = {
      name: file.name,
      path: `${dir.replace(/\/+$/, '')}/${file.name}`,
      type: 'file',
      size: file.size,
      mtime: mockDateTime(),
      permissions: 'rw-r--r--',
      content: await file.text(),
    };
    hostEntries(params.hostId).push(entry);
    return ok(toEntry(entry));
  }),
  mock(hostFileContract.remove, ({ params, query, ok }) => {
    removeWhere(hostEntries(params.hostId), (entry) => entry.path === query.path || entry.path.startsWith(`${query.path}/`));
    return ok(null);
  }),
];

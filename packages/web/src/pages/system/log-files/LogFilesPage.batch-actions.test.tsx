import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionContext } from '@/hooks/usePermission';
import { PreferencesContext } from '@/hooks/usePreferences';
import { createPreferencesContext } from '@/test-utils/preferences';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

// 同步 zip 会直接触发浏览器下载；替换掉真正的 blob 下载，只断言拿到的文件名
const downloadBlob = vi.fn();
vi.mock('@/utils/download', () => ({
  downloadBlob: (blob: Blob, filename: string) => downloadBlob(blob, filename),
}));

/** 混合响应替身：不经 jsdom 的 fetch 实现，只提供生产代码用到的那几个面 */
function rawResponse(headers: Record<string, string>, body: { json?: () => Promise<unknown>; blob?: () => Promise<Blob> }) {
  return {
    ok: true,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: body.json ?? (async () => { throw new Error('不是 JSON 响应'); }),
    blob: body.blob ?? (async () => new Blob([])),
  };
}

// Modal.confirm 是 Semi 的旧版命令式渲染 API（依赖 createRoot 注入），jsdom 下无法真实渲染；
// 记录确认回调，验证确认前不删除、确认后使用正确的请求载荷。
const confirmCalls: { title?: string; content?: React.ReactNode; okButtonProps?: Record<string, unknown>; onOk?: () => void | Promise<void> }[] = [];
const toastInfo = vi.fn();
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Toast, { info: (content: string) => toastInfo(content) });
  Object.assign(actual.Modal, {
    confirm: (config: { title?: string; content?: React.ReactNode; okButtonProps?: Record<string, unknown>; onOk?: () => void | Promise<void> }) => {
      confirmCalls.push(config);
      return { destroy: () => {} };
    },
  });
  return actual;
});

import LogFilesPage from './LogFilesPage';

const FILE_A = 'app.2026-10-12.1.log';
const FILE_B = 'app-api.2026-10-11.1.log';
const FILE_C = 'app-worker.2026-10-10.1.log';

const file = (name: string) => ({ name, size: 1024, modifiedAt: '2026-10-12 21:40:03', isGzip: false });

function renderPage() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/system/log-files']}>
        <PermissionContext.Provider value={['system:log:files', 'system:log:files:delete', 'system:log:files:download']}>
          <PreferencesContext.Provider value={createPreferencesContext()}>
            <LogFilesPage />
          </PreferencesContext.Provider>
        </PermissionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** 进入选择模式：勾选框与底部操作条只在显式进入后才渲染 */
function enterSelection() {
  fireEvent.click(screen.getByRole('button', { name: '选择' }));
}

/** 勾选指定文件：点复选框，不应顺带触发条目的「选中查看」 */
function check(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}` }));
}

const lastConfirm = () => confirmCalls[confirmCalls.length - 1];
const confirmOk = () => void lastConfirm().onOk?.();

beforeEach(() => {
  recorder.reset();
  confirmCalls.length = 0;
  downloadBlob.mockClear();
  toastInfo.mockClear();
  recorder.on('GET', '/api/log-files', [file(FILE_A), file(FILE_B), file(FILE_C)]);
  recorder.on('GET', /\/content/, { lines: [] });
  recorder.on('DELETE', '/api/log-files/batch', { deleted: 2 });
});

describe('日志文件选择模式下的批量操作（下载 / 删除）', () => {
  it('删除正在查看的文件后回到未选中态，且不回源已删文件的内容', async () => {
    renderPage();
    await screen.findByText(FILE_A);

    fireEvent.click(screen.getByText(FILE_A));
    await screen.findByPlaceholderText('搜索日志内容');
    await waitFor(() => expect(recorder.countOf('GET', /\/content/)).toBe(1));
    recorder.resetCalls();

    enterSelection();
    check(FILE_A);
    fireEvent.click(await screen.findByRole('button', { name: /删除 \(1\)/ }));
    expect(recorder.countOf('DELETE', '/api/log-files/batch')).toBe(0);
    confirmOk();

    await waitFor(() => expect(recorder.countOf('DELETE', '/api/log-files/batch')).toBe(1));
    await waitFor(() => expect(recorder.countOf('GET', '/api/log-files')).toBe(1));
    await screen.findByText('请从左侧选择一个日志文件查看');
    // 回归：content 查询与列表同属 'log-files' 前缀，域级失效会回源已删文件 → 404「文件不存在」
    expect(recorder.countOf('GET', /\/content/)).toBe(0);
  });

  it('多选打包下载：低于阈值时服务端返回 zip 流并直接触发下载', async () => {
    recorder.on('POST', '/api/log-files/batch-download', () => rawResponse(
      { 'content-type': 'application/zip', 'content-disposition': "attachment; filename*=UTF-8''logs_9.zip" },
      { blob: async () => new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]) },
    ));
    renderPage();
    await screen.findByText(FILE_A);

    enterSelection();
    check(FILE_B);
    check(FILE_C);
    const downloadButton = await screen.findByRole('button', { name: /下载 \(2\)/ });
    fireEvent.click(downloadButton);

    await waitFor(() => expect(recorder.countOf('POST', '/api/log-files/batch-download')).toBe(1));
    // fetchRaw 传的是已序列化的请求体（混合响应用不了 api() 的自动序列化）
    const postedBody = recorder.calls.find((c) => c.method === 'POST')?.body;
    expect(JSON.parse(String(postedBody))).toEqual({ filenames: [FILE_B, FILE_C] });
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(downloadBlob.mock.calls[0][1]).toBe('logs_9.zip');
    expect(toastInfo).not.toHaveBeenCalled();
    // 下载不改动列表：勾选与详情状态都保留
    expect(screen.getByRole('checkbox', { name: `选择 ${FILE_B}` })).toBeChecked();
  });

  it('超过阈值时转为后台任务，只提示并保留勾选', async () => {
    recorder.on('POST', '/api/log-files/batch-download', () => rawResponse(
      { 'content-type': 'application/json' },
      { json: async () => ({ code: 0, message: '文件较多，已转为后台打包，完成后通知', data: { mode: 'task', taskId: 9 } }) },
    ));
    renderPage();
    await screen.findByText(FILE_A);

    enterSelection();
    check(FILE_A);
    fireEvent.click(await screen.findByRole('button', { name: /下载 \(1\)/ }));

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('文件较多，已转为后台打包，完成后会通知你下载'));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('只有下载权限时：选择模式可用，但只出现下载按钮', async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/system/log-files']}>
          <PermissionContext.Provider value={['system:log:files', 'system:log:files:download']}>
            <PreferencesContext.Provider value={createPreferencesContext()}>
              <LogFilesPage />
            </PreferencesContext.Provider>
          </PermissionContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText(FILE_A);

    enterSelection();
    check(FILE_A);
    await screen.findByRole('button', { name: /下载 \(1\)/ });
    expect(screen.queryByRole('button', { name: /删除 \(/ })).not.toBeInTheDocument();
  });
});

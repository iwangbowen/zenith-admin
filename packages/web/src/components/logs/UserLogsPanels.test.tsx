/**
 * 「某个人」的登录记录 / 操作记录面板（个人中心与用户管理抽屉共用）：
 * 锁住两个 scope 的取数来源与按需拉取——
 *  - 本人 scope 走 `/api/auth/my-*`，不得带 `userId`（带了越权语义）；
 *  - 指定用户 scope 走管理侧 `/api/login-logs` / `/api/operation-logs` 并带 `userId` 精确筛选
 *    （管理侧的 `username` 是模糊关键字，用它定位某个人的记录会串号）；
 *  - 抽屉里未激活的 tab 不发请求，切过去才发。
 */
import { createPreferencesContext } from '@/test-utils/preferences';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesContext } from '@/hooks/usePreferences';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';
import { UserLoginLogsPanel, UserOperationLogsPanel } from './UserLogsPanels';
import { UserLogsSheet } from '@/pages/users/UserLogsSheet';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

const TARGET_USER_ID = 7;

const loginLogRow = {
  id: 101,
  userId: TARGET_USER_ID,
  username: 'target_user',
  nickname: '目标用户',
  ip: '10.0.0.9',
  location: '本地',
  browser: 'Chrome',
  os: 'Windows',
  userAgent: 'ua',
  eventType: 'login' as const,
  status: 'success' as const,
  message: null,
  createdAt: '2026-09-19 10:00:00',
};

const operationLogRow = {
  id: 202,
  userId: TARGET_USER_ID,
  username: 'target_user',
  nickname: '目标用户',
  module: '用户管理',
  description: '查询用户',
  method: 'GET',
  path: '/api/users',
  requestBody: null,
  beforeData: null,
  afterData: null,
  responseCode: 200,
  responseBody: null,
  durationMs: 12,
  ip: '10.0.0.9',
  userAgent: 'ua',
  os: 'Windows',
  browser: 'Chrome',
  createdAt: '2026-09-19 10:00:01',
};

/** 命中任一 URL 的请求（正则匹配，避免把 query string 写死在断言里） */
const hit = (pattern: RegExp) => recorder.urls('GET').filter((url) => pattern.test(url));

function renderWithProviders(ui: ReactNode) {
  const client = createTestQueryClient();
  const preferences = createPreferencesContext();
  return render(
    <QueryClientProvider client={client}>
      {/* OperationLogsTable 的详情弹窗用 useNavigate 跳链路追踪，需要 Router 上下文 */}
      <MemoryRouter>
        <PreferencesContext.Provider value={preferences}>{ui}</PreferencesContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', /\/api\/login-logs(\?|$)/, () => ({ list: [loginLogRow], total: 1 }));
  recorder.on('GET', /\/api\/operation-logs(\?|$)/, () => ({ list: [operationLogRow], total: 1 }));
  recorder.on('GET', '/api/auth/my-login-logs', () => ({ list: [{ ...loginLogRow, userId: 1 }], total: 1 }));
  recorder.on('GET', '/api/auth/my-operation-logs', () => ({ list: [{ ...operationLogRow, userId: 1 }], total: 1 }));
});

describe('指定用户 scope：走管理侧接口并按 userId 精确筛选', () => {
  it('登录记录请求带 userId 且渲染该用户的日志', async () => {
    renderWithProviders(
      <UserLoginLogsPanel scope={{ kind: 'user', userId: TARGET_USER_ID }} columnSettingsKey="t-login" />,
    );

    await waitFor(() => expect(hit(/\/api\/login-logs/)).toHaveLength(1));
    expect(hit(/\/api\/login-logs/)[0]).toContain(`userId=${TARGET_USER_ID}`);
    expect(hit(/\/api\/auth\/my-login-logs/)).toHaveLength(0);
    // 用户列渲染为「昵称（用户名）」
    expect(await screen.findAllByText(/目标用户（target_user）/)).not.toHaveLength(0);
  });

  it('操作记录请求带 userId（管理侧不是靠 username 模糊匹配定位个人）', async () => {
    renderWithProviders(
      <UserOperationLogsPanel scope={{ kind: 'user', userId: TARGET_USER_ID }} columnSettingsKey="t-operation" />,
    );

    await waitFor(() => expect(hit(/\/api\/operation-logs/)).toHaveLength(1));
    expect(hit(/\/api\/operation-logs/)[0]).toContain(`userId=${TARGET_USER_ID}`);
    expect(hit(/\/api\/auth\/my-operation-logs/)).toHaveLength(0);
    expect(await screen.findAllByText('查询用户')).not.toHaveLength(0);
  });

  it('enabled=false 时不发请求（抽屉未激活的 tab）', async () => {
    renderWithProviders(
      <UserLoginLogsPanel
        scope={{ kind: 'user', userId: TARGET_USER_ID }}
        enabled={false}
        columnSettingsKey="t-login"
      />,
    );

    // 撑过一轮微任务，确认没有任何请求发出
    await Promise.resolve();
    expect(hit(/\/api\/login-logs/)).toHaveLength(0);
  });
});

describe('本人 scope：个人中心走 my-* 端点且不带 userId', () => {
  it('登录记录请求本人端点且不带 userId', async () => {
    renderWithProviders(<UserLoginLogsPanel scope={{ kind: 'self' }} columnSettingsKey="t-self-login" />);

    await waitFor(() => expect(hit(/\/api\/auth\/my-login-logs/)).toHaveLength(1));
    expect(hit(/\/api\/auth\/my-login-logs/)[0]).not.toContain('userId');
    expect(hit(/\/api\/login-logs/)).toHaveLength(0);
  });

  it('操作记录请求本人端点且不带 userId', async () => {
    renderWithProviders(<UserOperationLogsPanel scope={{ kind: 'self' }} columnSettingsKey="t-self-operation" />);

    await waitFor(() => expect(hit(/\/api\/auth\/my-operation-logs/)).toHaveLength(1));
    expect(hit(/\/api\/auth\/my-operation-logs/)[0]).not.toContain('userId');
    expect(hit(/\/api\/operation-logs/)).toHaveLength(0);
  });
});

describe('用户管理抽屉：两个 tab 按需拉取', () => {
  it('打开时只拉登录记录，切到操作记录后才拉操作记录', async () => {
    renderWithProviders(
      <UserLogsSheet
        userId={TARGET_USER_ID}
        userName="目标用户（target_user）"
        visible
        canViewLoginLogs
        canViewOperationLogs
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText('登录与操作记录 · 目标用户（target_user）')).toBeTruthy();
    await waitFor(() => expect(hit(/\/api\/login-logs/)).toHaveLength(1));
    expect(hit(/\/api\/operation-logs/)).toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: /操作记录/ }));

    await waitFor(() => expect(hit(/\/api\/operation-logs/)).toHaveLength(1));
    expect(hit(/\/api\/operation-logs/)[0]).toContain(`userId=${TARGET_USER_ID}`);
    // 切 tab 不应把已经取过的登录记录再拉一遍
    expect(hit(/\/api\/login-logs/)).toHaveLength(1);
  });

  it('只有操作日志权限时只渲染操作记录，且不发登录记录的请求', async () => {
    renderWithProviders(
      <UserLogsSheet
        userId={TARGET_USER_ID}
        userName="目标用户（target_user）"
        visible
        canViewLoginLogs={false}
        canViewOperationLogs
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByRole('tab', { name: /登录记录/ })).toBeNull();
    await waitFor(() => expect(hit(/\/api\/operation-logs/)).toHaveLength(1));
    expect(hit(/\/api\/login-logs/)).toHaveLength(0);
  });
});

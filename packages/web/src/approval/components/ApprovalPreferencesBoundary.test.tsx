import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '@zenith/shared/core';
import { authContract } from '@zenith/shared/identity';
import { preferencePolicySchema } from '@zenith/shared/preferences';
import { settingsProjectionContract } from '@zenith/shared/settings/projections';
import { contractKey } from '@/lib/contract-query';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const requests = vi.hoisted(() => ({ approval: vi.fn(), admin: vi.fn() }));
vi.mock('../lib/approval-request', () => ({ approvalRequest: { get: requests.approval } }));
vi.mock('@/utils/request', () => ({ request: { get: requests.admin } }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div>审批登录</div> }));
vi.mock('../pages/TaskListPage', () => ({ default: () => <div>审批工作台</div> }));
vi.mock('../pages/TaskDetailPage', () => ({ default: () => null }));
vi.mock('../pages/LaunchListPage', () => ({ default: () => null }));
vi.mock('../pages/LaunchFormPage', () => ({ default: () => null }));

import ApprovalApp from '../App-approval';
import { approvalQueryClient } from '../lib/query-client';
import { ApprovalPreferencesBoundary } from './ApprovalPreferencesBoundary';

const response = (data: unknown) => ({ code: 0, message: 'success', data });
let policy = preferencePolicySchema.parse({});

function setup() {
  const client = createTestQueryClient();
  const view = render(<ApprovalPreferencesBoundary>审批表单</ApprovalPreferencesBoundary>, { wrapper: createWrapper(client) });
  return { client, ...view };
}

beforeEach(() => {
  requests.approval.mockReset();
  requests.admin.mockReset();
  localStorage.clear();
  window.location.hash = '#/';
  policy = preferencePolicySchema.parse({});
  requests.approval.mockImplementation(async (url: string) => response(
    url === authContract.preferences.fullPath
      ? { overrides: { multiSelectLayout: 'wrap' } }
      : { ui: { preferences: policy } },
  ));
});

afterEach(() => {
  cleanup();
  approvalQueryClient.clear();
  delete document.body.dataset.multiSelectLayout;
});

describe('ApprovalPreferencesBoundary', () => {
  it('uses only the approval client for both preference requests', async () => {
    const { unmount, client } = setup();
    await waitFor(() => expect(client.getQueryState(contractKey(settingsProjectionContract.me))?.status).toBe('success'));
    expect(requests.approval.mock.calls.map(([url]) => url).sort()).toEqual([
      authContract.preferences.fullPath, settingsProjectionContract.me.fullPath,
    ].sort());
    expect(requests.approval).toHaveBeenCalledWith(authContract.preferences.fullPath, { silent: true });
    expect(requests.admin).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fetch preferences on the login route', async () => {
    render(<ApprovalApp />);
    expect(await screen.findByText('审批登录')).toBeTruthy();
    expect(requests.approval).not.toHaveBeenCalled();
  });

  it('clears cached personal preferences when leaving authenticated routes', async () => {
    localStorage.setItem(TOKEN_KEY, 'approval-test-token');
    render(<ApprovalApp />);
    expect(await screen.findByText('审批工作台')).toBeTruthy();
    await waitFor(() => expect(approvalQueryClient.getQueryData(contractKey(authContract.preferences))).toBeDefined());
    await act(async () => {
      localStorage.removeItem(TOKEN_KEY);
      window.location.hash = '#/login';
    });
    expect(await screen.findByText('审批登录')).toBeTruthy();
    await waitFor(() => expect(approvalQueryClient.getQueryData(contractKey(authContract.preferences))).toBeUndefined());
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_MODULES, type SettingsRevisionDetail } from '@zenith/shared/settings';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { SettingsHistoryButton } from './SettingsHistoryButton';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { tablePageSize: 10 }, updatePreferences: vi.fn() }),
  useOptionalPreferences: () => ({ preferences: { tablePageSize: 10 }, updatePreferences: vi.fn() }),
  defaultPreferences: { tablePageSize: 10 },
}));

beforeEach(() => recorder.reset());

describe('初始版本比较', () => {
  it('留存历史从 v2 开始时默认比较 v0，不请求不存在的 v1', async () => {
    const effective = SETTINGS_MODULES.wiki.schema.parse({});
    const revision: SettingsRevisionDetail = {
      id: 20, version: 2, action: 'initial', restoredFromVersion: null, note: '初始快照',
      actorId: 1, actorName: 'admin', createdAt: null, changedPaths: [],
      overrides: {}, inherited: effective, effective, definitionHash: 'definition', definition: {}, inheritedVersion: 0,
    };
    recorder.on('GET', '/api/settings/wiki', {
      module: 'wiki', scope: 'platform', tenantId: null, version: 2, currentRevisionId: 20,
      baseToken: 'current', inheritedVersion: 0, definitionHash: 'definition', overrides: {},
      effective, inherited: effective, overriddenPaths: [], updatedAt: null,
    });
    recorder.on('GET', '/api/settings/wiki/versions?page=1&pageSize=10', { list: [revision], total: 1, page: 1, pageSize: 10 });
    recorder.on('GET', '/api/settings/wiki/versions/0', { ...revision, id: 0, version: 0 });
    recorder.on('GET', '/api/settings/wiki/versions/2', revision);
    recorder.on('GET', '/api/settings/wiki/versions/compare?from=0&to=2', { fromVersion: 0, toVersion: 2, changes: [] });
    render(<SettingsHistoryButton module="wiki" />, { wrapper: createWrapper(createTestQueryClient()) });
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    fireEvent.click(await screen.findByRole('button', { name: /版本 2/ }));
    fireEvent.click(screen.getByRole('tab', { name: '版本比较' }));
    await waitFor(() => expect(recorder.countOf('GET', '/api/settings/wiki/versions/compare?from=0&to=2')).toBe(1));
    expect(recorder.urls('GET').some((url) => url.includes('from=1'))).toBe(false);
  });
});

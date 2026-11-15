import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ipAccessSettingsSchema, type SettingsEnvelope } from '@zenith/shared/settings';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
import { useIpAccessContext } from './ip-access';
import { invalidateSettingsEffects } from './settings-effects';

describe('IP context settings invalidation', () => {
  it('refetches the active observed-source context after saving or restoring policy', async () => {
    let version = 1;
    recorder.on('GET', '/api/ip-access/context', () => ({ clientIp: '192.0.2.10', version, baseToken: 'v' + version,
      decision: { allowed: true, reason: 'disabled', matchedEntry: null } }));
    const client = createTestQueryClient();
    const { result } = renderHook(() => useIpAccessContext(), { wrapper: createWrapper(client) });
    await waitFor(() => expect(result.current.data?.version).toBe(1));
    const policy = ipAccessSettingsSchema.parse({});
    const saved: SettingsEnvelope<'ipAccess'> = {
      module: 'ipAccess', scope: 'platform', tenantId: null, version: 2, currentRevisionId: 2, baseToken: 'v2', definitionHash: 'd',
      overrides: {}, overriddenPaths: [], inheritedVersion: 0, effective: policy, inherited: policy, updatedAt: null,
    };
    version = 2;
    act(() => invalidateSettingsEffects(client, 'ipAccess', saved, undefined));
    await waitFor(() => expect(result.current.data?.version).toBe(2));
    expect(recorder.countOf('GET', '/api/ip-access/context')).toBe(2);
  });
});

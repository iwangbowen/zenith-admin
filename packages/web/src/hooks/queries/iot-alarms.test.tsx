import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { iotAlarmContract } from '@zenith/shared/iot';
import { entityRelationsContract, entityTimelineContract } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { urlOf } from '@/lib/contract-query';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 }, impersonation: null }) }));

import { useAcknowledgeIotAlarm, useIotAlarmDetail, useIotAlarmList, useResolveIotAlarm } from './iot-alarms';
import { useEntityRelations, useEntityRelationSection, useEntityTimeline } from './entity-relations';

beforeEach(() => recorder.reset());

describe('IoT alarm detail and relation cache consistency', () => {
  it('reloads the full detail, list, summary, section and timeline after acknowledgement and resolution', async () => {
    const ref = { type: 'iot.alarm' as const, key: '7' };
    let status = 'firing';
    const detailUrl = urlOf(iotAlarmContract.detail, { params: { id: 7 } });
    recorder.on('GET', detailUrl, () => ({ id: 7, status, deviceName: '测试设备', acknowledgedByName: status === 'firing' ? null : '处理人' }));
    recorder.on('GET', urlOf(iotAlarmContract.list, { query: { page: 1, pageSize: 10 } }).split('?')[0], () => ({ list: [{ id: 7, status }], total: 1, page: 1, pageSize: 10 }));
    recorder.on('GET', urlOf(entityRelationsContract.describe, { params: ref }), () => ({ anchor: { ref, title: status }, sections: [], canManageLinks: false }));
    recorder.on('GET', urlOf(entityRelationsContract.section, { params: { ...ref, sectionKey: 'iot.alarm.device' }, query: { limit: 5 } }).split('?')[0], () => ({ items: [], hasMore: false, nextCursor: null }));
    recorder.on('GET', urlOf(entityTimelineContract.timeline, { params: ref, query: { limit: 20 } }).split('?')[0], () => ({ items: [], hasMore: false, nextCursor: null }));
    recorder.on('POST', urlOf(iotAlarmContract.acknowledge, { params: { id: 7 } }), () => { status = 'acknowledged'; return { id: 7, status, deviceName: null }; });
    recorder.on('POST', urlOf(iotAlarmContract.resolve, { params: { id: 7 } }), () => { status = 'resolved'; return { id: 7, status, deviceName: null }; });
    const client = createTestQueryClient();
    const hook = renderHook(() => ({
      detail: useIotAlarmDetail(7), list: useIotAlarmList({ page: 1, pageSize: 10 }),
      summary: useEntityRelations(ref.type, ref.key), section: useEntityRelationSection(ref.type, ref.key, 'iot.alarm.device'),
      timeline: useEntityTimeline(ref.type, ref.key), acknowledge: useAcknowledgeIotAlarm(), resolve: useResolveIotAlarm(),
    }), { wrapper: createWrapper(client) });
    await waitFor(() => expect([hook.result.current.timeline, hook.result.current.detail, hook.result.current.list,
      hook.result.current.summary, hook.result.current.section].every((query) => query.isSuccess)).toBe(true));
    for (const next of ['acknowledged', 'resolved']) {
      recorder.resetCalls();
      await act(async () => {
        if (next === 'acknowledged') await hook.result.current.acknowledge.mutateAsync({ params: { id: 7 } });
        else await hook.result.current.resolve.mutateAsync({ params: { id: 7 }, body: { note: '已处理' } });
      });
      await waitFor(() => expect(hook.result.current.detail.data?.status).toBe(next));
      expect(hook.result.current.detail.data?.deviceName).toBe('测试设备');
      await waitFor(() => expect(recorder.countOf('GET')).toBe(5));
    }
    hook.unmount(); client.clear();
  });
});

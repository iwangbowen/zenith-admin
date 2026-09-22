import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import type { IotAlarmRow } from '../../db/schema';
const recorded = vi.hoisted(() => vi.fn());
vi.mock('../platform/relations/events.service', () => ({ recordDomainEvent: recorded }));
import { recordIotAlarmEvent } from './iot-alarm-events';

describe('IoT alarm business events', () => {
  it.each(['firing', 'acknowledged', 'resolved'] as const)('projects %s from the persisted alarm and its owning device tenant', async (status) => {
    recorded.mockClear();
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ tenantId: 7 }] }) }) }) } as unknown as DbTransaction;
    await recordIotAlarmEvent(tx, { id: 9, deviceId: 31, ruleName: 'Temperature', level: 'warning', status,
      message: 'sensitive diagnostic', context: { token: 'sensitive' } } as unknown as IotAlarmRow);
    expect(recorded).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 7, source: { type: 'iot.alarm', key: '9' },
      subjects: [{ type: 'iot.alarm', key: '9', role: 'primary' }, { type: 'iot.device', key: '31', role: 'related' }],
      payload: { ruleName: 'Temperature', level: 'warning', status } }));
    expect(JSON.stringify(recorded.mock.calls[0][1])).not.toContain('sensitive');
  });
});

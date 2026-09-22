import { describe, expect, it } from 'vitest';
import { iotAlarmContract, iotAlarmSchema } from '@zenith/shared/iot';
import { urlOf } from '@/lib/contract-query';
import { iotHandlers } from './handlers/iot';
import { mockIotAlarms } from './data/iot';

async function call(path: string, method = 'GET', body?: unknown) {
  const request = new Request(`${window.location.origin}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const handler of iotHandlers) {
    const result = await handler.run({ request, requestId: 'iot-alarm-detail' });
    if (result?.response) return result.response;
  }
  throw new Error('No handler matched');
}

describe('IoT exact alarm details in Demo', () => {
  it('returns the requested record independently of list filtering and reflects later actions', async () => {
    const fixture = mockIotAlarms.find((alarm) => alarm.status === 'firing')!;
    const original = { ...fixture };
    try {
      const url = urlOf(iotAlarmContract.detail, { params: { id: fixture.id } });
      const read = async () => iotAlarmSchema.parse((await (await call(url)).json()).data);
      expect(await read()).toEqual(fixture);
      await call(urlOf(iotAlarmContract.acknowledge, { params: { id: fixture.id } }), 'POST');
      expect((await read()).status).toBe('acknowledged');
      await call(urlOf(iotAlarmContract.resolve, { params: { id: fixture.id } }), 'POST', { note: '现场处理完成' });
      const resolved = await read();
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolveNote).toBe('现场处理完成');
      expect(resolved.deviceName).toBe(original.deviceName);
    } finally { Object.assign(fixture, original); }
  });

  it('does not substitute another record when an ID is missing or malformed', async () => {
    expect((await call(urlOf(iotAlarmContract.detail, { params: { id: 2_147_483_647 } }))).status).toBe(404);
    expect((await call(urlOf(iotAlarmContract.detail, { params: { id: -1 } }))).status).toBe(400);
  });
});

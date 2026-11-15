import { ipAccessLogContract, ipAccessContract } from '@zenith/shared/platform';
import { evaluateIpAccess } from '@zenith/shared/settings';
import { assertMockSettingsBase, mockSettingsEnvelope } from '@/mocks/data/settings';
import { mock } from '@/mocks/utils/contract';
import { mockIpAccessLogs } from '@/mocks/data/logs';
import { withinDateRange } from '@/mocks/utils/filter';

export const ipAccessLogsHandlers = [
  mock(ipAccessContract.context, ({ ok }) => {
    const current = mockSettingsEnvelope('ipAccess');
    return ok({ clientIp: '192.0.2.10', version: current.version, baseToken: current.baseToken, decision: evaluateIpAccess(current.effective, '192.0.2.10') });
  }),
  mock(ipAccessContract.diagnose, ({ body, ok }) => {
    assertMockSettingsBase('ipAccess', body.baseToken);
    const clientIp = '192.0.2.10';
    const testedIp = body.ip ?? clientIp;
    return ok({ clientIp, testedIp, version: mockSettingsEnvelope('ipAccess').version, baseToken: body.baseToken,
      currentDecision: evaluateIpAccess(body.policy, clientIp), decision: evaluateIpAccess(body.policy, testedIp) });
  }),
  mock(ipAccessLogContract.list, ({ query, ok, paginate }) => {
    const { ip, blockType, startTime, endTime } = query;
    const list = mockIpAccessLogs.filter((log) => {
      if (ip && !log.ip.includes(ip)) return false;
      if (blockType && log.blockType !== blockType) return false;
      if (!withinDateRange(log.createdAt, startTime, endTime)) return false;
      return true;
    });
    return ok(paginate(list));
  }),
];

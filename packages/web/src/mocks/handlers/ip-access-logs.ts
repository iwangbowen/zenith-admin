import { ipAccessLogContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { mockIpAccessLogs } from '@/mocks/data/logs';

export const ipAccessLogsHandlers = [
  mock(ipAccessLogContract.list, ({ query, ok, paginate }) => {
    const { ip, blockType } = query;
    const list = mockIpAccessLogs.filter((log) => {
      if (ip && !log.ip.includes(ip)) return false;
      if (blockType && log.blockType !== blockType) return false;
      return true;
    });
    return ok(paginate(list));
  }),
];

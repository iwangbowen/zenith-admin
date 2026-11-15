import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipAccessSettingsSchema } from '@zenith/shared/settings';
vi.mock('../../lib/settings', () => ({ getSettingsEnvelope: vi.fn() }));
import { getSettingsEnvelope } from '../../lib/settings';
import { diagnoseIpAccess, getIpAccessContext } from './ip-access.service';
const policy = ipAccessSettingsSchema.parse({ blacklistEnabled: true, blacklist: ['192.0.2.10'] });
beforeEach(() => {
  vi.mocked(getSettingsEnvelope).mockResolvedValue({ version: 4, baseToken: 'base', effective: policy } as never);
});
describe('IP diagnosis', () => {
  it('uses the same policy for custom and observed sources without writes', async () => {
    const result = await diagnoseIpAccess({ baseToken: 'base', policy, ip: '198.51.100.1' }, '192.0.2.10');
    expect(result).toMatchObject({ clientIp: '192.0.2.10', currentDecision: { allowed: false }, decision: { allowed: true }, version: 4 });
    expect(await getIpAccessContext('192.0.2.10')).toMatchObject({ decision: { allowed: false, matchedEntry: '192.0.2.10' } });
  });
  it('rejects stale base versions', async () => {
    await expect(diagnoseIpAccess({ baseToken: 'old', policy }, '192.0.2.10')).rejects.toMatchObject({ status: 409 });
  });
});

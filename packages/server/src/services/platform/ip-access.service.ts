import type * as z from 'zod';
import { ipAccessContract } from '@zenith/shared/platform';
import { evaluateIpAccess } from '@zenith/shared/settings';
import { getSettingsEnvelope } from '../../lib/settings';
import { HTTPException } from 'hono/http-exception';

export async function getIpAccessContext(clientIp: string) {
  const current = await getSettingsEnvelope('ipAccess');
  return { clientIp, version: current.version, baseToken: current.baseToken, decision: evaluateIpAccess(current.effective, clientIp) };
}

export async function diagnoseIpAccess(input: z.output<typeof ipAccessContract.diagnose.body>, clientIp: string) {
  const current = await getSettingsEnvelope('ipAccess');
  if (current.baseToken !== input.baseToken) throw new HTTPException(409, { message: '策略版本已变化，请载入最新版本后重新诊断' });
  const testedIp = input.ip ?? clientIp;
  return { clientIp, testedIp, version: current.version, baseToken: current.baseToken,
    currentDecision: evaluateIpAccess(input.policy, clientIp), decision: evaluateIpAccess(input.policy, testedIp) };
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { stableStringify } from '@zenith/shared/core';
import { HTTPException } from 'hono/http-exception';
import { config } from '../../config';
import { currentUser } from '../../lib/context';

function signature(action: string, filter: unknown, objects: unknown, expires: number) {
  const user = currentUser();
  return createHmac('sha256', config.jwtSecret).update(stableStringify({ action, filter, objects, expires, userId: user.userId, tenantId: user.tenantId, viewingTenantId: user.viewingTenantId })).digest('hex');
}
export function issueWorkflowPreview(action: string, filter: unknown, objects: unknown) {
  const expires = Date.now() + 5 * 60_000;
  return `${expires}.${signature(action, filter, objects, expires)}`;
}
export function assertWorkflowPreview(proof: string | undefined, action: string, filter: unknown, objects: unknown) {
  const [rawExpires, supplied] = (proof ?? '').split('.');
  const expires = Number(rawExpires);
  const expected = signature(action, filter, objects, expires);
  const received = Buffer.from(supplied ?? '');
  const wanted = Buffer.from(expected);
  if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 5 * 60_000 || received.length !== wanted.length || !timingSafeEqual(received, wanted)) throw new HTTPException(409, { message: '预检缺失、已过期或对象已变化，请重新预览' });
}

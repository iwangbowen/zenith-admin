import { HTTPException } from 'hono/http-exception';
import type { JwtPayload } from '../../middleware/auth';
import { currentUser } from '../../lib/context';
import { isSuperAdmin } from '../../lib/permissions';

export function isCmsPlatformAdmin(user: JwtPayload = currentUser()): boolean {
  return isSuperAdmin(user);
}

/** Fail closed: every requested object must be present in the resolved result set. */
export function assertCompleteCmsBatch(
  requestedIds: number[],
  foundIds: number[],
  label = 'CMS 对象',
): number[] {
  const requested = [...new Set(requestedIds)];
  const found = new Set(foundIds);
  if (requested.some((id) => !found.has(id))) {
    throw new HTTPException(404, { message: `所选${label}包含不存在或无权访问的对象` });
  }
  return requested;
}

export function canAccessBoundCmsObject(input: {
  user: JwtPayload;
  objectId: number;
  boundIds: readonly number[];
}): boolean {
  if (isCmsPlatformAdmin(input.user)) return true;
  return input.boundIds.includes(input.objectId);
}

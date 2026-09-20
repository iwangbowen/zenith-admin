import { createHmac, timingSafeEqual } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { config } from '../../../config';

/** Internal keyset cursor. Public cursors are authenticated and bound below. */
export function encodeRelationCursor(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid relation keyset');
  return String(id);
}
export function decodeRelationCursor(value?: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new HTTPException(400, { message: '关联分页游标无效' });
  }
  return Number(value);
}
export function signRelationCursor(value: string, scope: string): string {
  const data = Buffer.from(JSON.stringify({ v: 1, scope, value })).toString('base64url');
  return `${data}.${createHmac('sha256', config.jwtSecret).update(data).digest('base64url')}`;
}
export function readRelationCursor(cursor: string | undefined, scope: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const [data, signature, extra] = cursor.split('.');
    if (!data || !signature || extra) throw new Error('format');
    const actual = Buffer.from(signature, 'base64url');
    const expected = createHmac('sha256', config.jwtSecret).update(data).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('signature');
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as { v: number; scope: string; value: string };
    if (payload.v !== 1 || payload.scope !== scope || typeof payload.value !== 'string') throw new Error('scope');
    return payload.value;
  } catch {
    throw new HTTPException(400, { message: '关联分页游标无效或不属于当前对象' });
  }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
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
  // A continuation may point past hidden records. Authentication alone would
  // expose those object keys after base64 decoding, so the position is encrypted.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cursorKey(), iv);
  cipher.setAAD(Buffer.from(scope));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ value }), 'utf8'), cipher.final()]);
  return ['2', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}
function cursorKey() { return createHash('sha256').update('zenith:relation-cursor:v2\0').update(config.jwtSecret).digest(); }
function decodePart(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('format');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('format');
  return decoded;
}
export function readRelationCursor(cursor: string | undefined, scope: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const [version, nonce, data, tag, extra] = cursor.split('.');
    if (version !== '2' || !nonce || !data || !tag || extra || cursor.length > 4096) throw new Error('format');
    const iv = decodePart(nonce), authTag = decodePart(tag);
    if (iv.length !== 12 || authTag.length !== 16) throw new Error('format');
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(), iv);
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(authTag);
    const payload = JSON.parse(Buffer.concat([decipher.update(decodePart(data)), decipher.final()]).toString('utf8')) as { value: string };
    if (typeof payload.value !== 'string') throw new Error('format');
    return payload.value;
  } catch {
    throw new HTTPException(400, { message: '关联分页游标无效或不属于当前对象' });
  }
}

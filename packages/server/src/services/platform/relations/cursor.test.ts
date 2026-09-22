import { describe, expect, it } from 'vitest';
import { readRelationCursor, signRelationCursor } from './cursor';

describe('opaque authorized continuation positions', () => {
  it('does not disclose a skipped hidden object and authenticates the filter and actor scope', () => {
    const position = JSON.stringify(['payment.order', 'hidden-business-key-91371']);
    const scope = JSON.stringify({ actor: 5, tenant: 2, keyword: 'invoice' });
    const cursor = signRelationCursor(position, scope);
    expect(cursor).not.toBe(signRelationCursor(position, scope));
    expect(readRelationCursor(cursor, scope)).toBe(position);
    for (const part of cursor.split('.').slice(1)) expect(Buffer.from(part, 'base64url').toString()).not.toContain('hidden-business-key-91371');
    expect(() => readRelationCursor(cursor, JSON.stringify({ actor: 6, tenant: 2, keyword: 'invoice' }))).toThrow();
    expect(() => readRelationCursor(cursor, JSON.stringify({ actor: 5, tenant: 2, keyword: 'other' }))).toThrow();
    const parts = cursor.split('.');
    const changed = Buffer.from(parts[2], 'base64url'); changed[0] ^= 1;
    parts[2] = changed.toString('base64url');
    expect(() => readRelationCursor(parts.join('.'), scope)).toThrow();
  });
});

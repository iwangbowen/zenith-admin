import { describe, it, expect } from 'vitest';
import { sanitizeBody } from '../lib/sanitize';

describe('sanitizeBody', () => {
  it('should return empty string for null/undefined', () => {
    expect(sanitizeBody(null)).toBe('');
    expect(sanitizeBody(undefined)).toBe('');
  });

  it('should redact password fields', () => {
    const body = { username: 'admin', password: '123456' };
    const result = JSON.parse(sanitizeBody(body));
    expect(result.username).toBe('admin');
    expect(result.password).toBe('***');
  });

  it('should redact nested sensitive fields', () => {
    const body = { config: { accessKey: 'my-key', name: 'test' } };
    const result = JSON.parse(sanitizeBody(body));
    expect(result.config.accessKey).toBe('***');
    expect(result.config.name).toBe('test');
  });

  it('should redact multiple sensitive key patterns', () => {
    const body = {
      secret: 'sec',
      token: 'tok',
      privateKey: 'pk',
      access_key: 'ak',
      normalField: 'ok',
    };
    const result = JSON.parse(sanitizeBody(body));
    expect(result.secret).toBe('***');
    expect(result.token).toBe('***');
    expect(result.privateKey).toBe('***');
    expect(result.access_key).toBe('***');
    expect(result.normalField).toBe('ok');
  });

  it('should not mutate the original object', () => {
    const body = { password: 'original' };
    sanitizeBody(body);
    expect(body.password).toBe('original');
  });
});

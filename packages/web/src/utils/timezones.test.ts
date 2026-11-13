import { describe, expect, it } from 'vitest';
import { IANA_TIMEZONE_OPTIONS } from './timezones';

describe('IANA_TIMEZONE_OPTIONS', () => {
  it('exposes unique IANA timezone identifiers', () => {
    const values = IANA_TIMEZONE_OPTIONS.map((option) => option.value);

    expect(values).toContain('UTC');
    expect(values).toContain('America/New_York');
    expect(new Set(values).size).toBe(values.length);
  });
});

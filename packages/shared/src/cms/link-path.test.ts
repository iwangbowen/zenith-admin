import { describe, expect, it } from 'vitest';
import { cmsSiteRelativePath } from './link';

describe('site-relative preview links', () => {
  it('preserves path/query/hash while removing exactly the current preview mount', () => {
    expect(cmsSiteRelativePath('/__cms/culture/p/read/?q=书#section', 'culture')).toBe('/p/read/?q=书#section');
    expect(cmsSiteRelativePath('/__cms/culture?x=1', 'culture')).toBe('/?x=1');
    expect(cmsSiteRelativePath('/news/', 'culture')).toBe('/news/');
  });
  it.each(['/__cms/other/news/', '/__cms/culture/__cms/culture/news/', '//evil.test', '/__cms/culture/%2e%2e/secret'])('rejects cross-site or unsafe paths: %s', (path) => {
    expect(cmsSiteRelativePath(path, 'culture')).toBeNull();
  });
});

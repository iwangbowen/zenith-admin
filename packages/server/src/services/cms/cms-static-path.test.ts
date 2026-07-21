import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CMS_STATIC_ROOT, pathToStaticFile, resolveStaticFile, siteStaticDir,
} from './cms-static-path';

describe('CMS static path containment', () => {
  it('resolves valid site files strictly below CMS_STATIC_ROOT', () => {
    const file = resolveStaticFile('main-site', 'news/index.html');
    expect(file).not.toBeNull();
    expect(path.relative(CMS_STATIC_ROOT, file!)).toBe(path.join('main-site', 'news', 'index.html'));
  });

  it.each([
    '../../outside',
    '..\\..\\outside',
    '/../../outside',
    'news/../outside',
    'news/./index.html',
    'C:\\Windows\\win.ini',
    'news/index.html:secret',
  ])('rejects traversal payload %s', (payload) => {
    expect(resolveStaticFile('main-site', payload)).toBeNull();
  });

  it.each(['..', '.', '../site', 'site/name', 'site\\name'])(
    'rejects unsafe site code %s',
    (code) => expect(() => siteStaticDir(code)).toThrow(),
  );

  it('maps directory paths to index.html', () => {
    expect(pathToStaticFile('news/')).toBe('news/index.html');
  });
});

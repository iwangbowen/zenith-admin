import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { prepareCmsWorkbenchHtml } from './cms-workbench-preview-html';

describe('CMS private preview document', () => {
  it('keeps internal navigation in the same context and disables execution and real submissions', () => {
    const result = prepareCmsWorkbenchHtml(`<html><head><base href="https://evil.invalid"><meta http-equiv="refresh" content="0;url=/api/delete"><script>track()</script></head><body onload="track()"><iframe src="/api/track"></iframe><form action="/api/forms" method="post"><input name="x"><button>提交</button></form><a href="/__cms/demo/news/" onclick="track()" target="_top">news</a><a href="/__cms/demo?q=1">search</a><a href="https://example.com">external</a><a href="/api/files/1/content">download</a></body></html>`, '/__cms/demo');
    const $ = load(result);
    expect($('script,base,iframe,meta[http-equiv="refresh"],[onclick],[onload]').length).toBe(0);
    expect($('form').attr('action')).toBeUndefined();
    expect($('input,button').toArray().every((element) => $(element).attr('disabled') !== undefined)).toBe(true);
    expect($('a[data-cms-preview-path]').map((_index, node) => $(node).attr('data-cms-preview-path')).get()).toEqual(['/news/', '/?q=1']);
    expect($('a[aria-disabled]').length).toBe(2);
    expect($('meta[name="robots"]').attr('content')).toBe('noindex,nofollow');
  });
});

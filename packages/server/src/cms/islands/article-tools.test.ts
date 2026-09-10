// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountArticleTools } from './article-tools';
import { html } from './test-utils';

const PAGE = `<div class="article-tools" data-island="article-tools">
  <button type="button" data-fs="fs-small">小</button>
  <button type="button" data-fs="" class="on">中</button>
  <button type="button" data-fs="fs-large">大</button>
  <button type="button" data-print="1">打印</button>
</div>
<article class="article"><h1>标题</h1></article>`;

describe('article-tools island', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => vi.restoreAllMocks());

  it('字号切换：切换正文 class 并高亮当前按钮；打印按钮调用 window.print', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const root = html(PAGE);
    const bar = root.querySelector<HTMLElement>('.article-tools')!;
    const article = root.querySelector<HTMLElement>('.article')!;
    mountArticleTools(bar);

    const [small, medium, large, printButton] = [...bar.querySelectorAll<HTMLButtonElement>('button')];
    large.click();
    expect(article.classList.contains('fs-large')).toBe(true);
    expect(large.classList.contains('on')).toBe(true);
    expect(medium.classList.contains('on')).toBe(false);

    small.click();
    expect(article.classList.contains('fs-small')).toBe(true);
    expect(article.classList.contains('fs-large')).toBe(false);

    medium.click();
    expect(article.className).toBe('article');
    expect(medium.classList.contains('on')).toBe(true);

    printButton.click();
    expect(print).toHaveBeenCalledTimes(1);
    expect(article.className).toBe('article');
  });

  it('页面无 .article 正文：静默 no-op', () => {
    const bar = html('<div class="article-tools"><button type="button" data-fs="fs-large">大</button></div>').querySelector<HTMLElement>('.article-tools')!;
    expect(() => mountArticleTools(bar)).not.toThrow();
    bar.querySelector('button')!.click();
  });
});

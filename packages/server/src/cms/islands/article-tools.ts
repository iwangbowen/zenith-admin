/**
 * 政务门户正文工具条（`.article-tools`）：打印按钮（data-print）与字号切换（data-fs=""|fs-small|fs-large），
 * 作用于同页 `.article` 正文容器。
 */
export function mountArticleTools(el: HTMLElement): void {
  const article = document.querySelector<HTMLElement>('.article');
  if (!article) return;
  el.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-print')) {
      window.print();
      return;
    }
    const size = button.getAttribute('data-fs');
    if (size === null) return;
    article.classList.remove('fs-small', 'fs-large');
    if (size) article.classList.add(size);
    for (const other of el.querySelectorAll<HTMLElement>('button[data-fs]')) {
      other.classList.toggle('on', other === button);
    }
  });
}

import type { CSSProperties } from 'react';
import { Typography } from '@douyinfe/semi-ui';
import DOMPurify from 'dompurify';

function display(value: unknown, html: boolean) {
  if (value == null || value === '') return '（空）';
  if (html && typeof value === 'string') return DOMPurify.sanitize(value, { ALLOWED_TAGS: [] });
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

/** Highlight the changed text while retaining shared context, including Unicode characters. */
export default function CmsValueDiff({ before, after, html = false }: Readonly<{ before: unknown; after: unknown; html?: boolean }>) {
  const left = Array.from(display(before, html));
  const right = Array.from(display(after, html));
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const render = (value: string[], added: boolean) => <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto', padding: 12 }}>
    {value.slice(0, prefix).join('')}
    {added ? <ins style={{ background: 'var(--semi-color-success-light-default)' }}>{value.slice(prefix, value.length - suffix).join('')}</ins>
      : <del style={{ background: 'var(--semi-color-danger-light-default)' }}>{value.slice(prefix, value.length - suffix).join('')}</del>}
    {suffix ? value.slice(value.length - suffix).join('') : ''}
  </div>;
  return <div className="auto-grid" style={{ '--auto-grid-cols': 2 } as CSSProperties}>
    <div><Typography.Text type="secondary">历史修订</Typography.Text>{render(left, false)}</div>
    <div><Typography.Text type="secondary">当前工作稿</Typography.Text>{render(right, true)}</div>
  </div>;
}

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button, Form } from '@douyinfe/semi-ui';
import { describe, expect, it, vi } from 'vitest';
import CmsPageBlockFields from './CmsPageBlockFields';

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => true }) }));
vi.mock('./CmsLinkInput', () => ({ FormCmsLinkField: ({ field, label }: { field: string; label: string }) => <Form.Input field={field} label={label} /> }));
vi.mock('./components/CmsAssetField', () => ({ CmsAssetField: ({ value, onChange, siteId }: { value?: string; onChange?: (value: string) => void; siteId?: number }) => (
  <button type="button" onClick={() => onChange?.('cms-res://47')}>选择本站 {siteId} 图片 {value}</button>
) }));
vi.mock('@/components/RichTextEditor', () => ({ default: ({ value, onChange }: { value?: string; onChange?: (value: string) => void }) => <textarea aria-label="可视正文编辑器" value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} /> }));

describe('页面搭建媒体和富文本字段', () => {
  it('uses the current site media selector and submits the selected hero asset with other block properties', async () => {
    const submit = vi.fn();
    render(<Form onSubmit={submit} initValues={{ title: '活动标题', image: '', buttonUrl: '/details/' }}><CmsPageBlockFields type="hero" siteId={9} /><Button htmlType="submit">保存区块</Button></Form>);
    fireEvent.click(screen.getByRole('button', { name: /选择本站 9 图片/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存区块' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({ title: '活动标题', image: 'cms-res://47', buttonUrl: '/details/' });
  });

  it('round-trips HTML through the visual editor and does not require editing markup in a source textarea', async () => {
    const submit = vi.fn();
    render(<Form onSubmit={submit} initValues={{ html: '<p>原文</p>' }}><CmsPageBlockFields type="richtext" siteId={9} /><Button htmlType="submit">保存区块</Button></Form>);
    const editor = await screen.findByRole('textbox', { name: '可视正文编辑器' });
    expect(editor).toHaveValue('<p>原文</p>');
    fireEvent.change(editor, { target: { value: '<p><strong>更新正文</strong></p>' } });
    fireEvent.click(screen.getByRole('button', { name: '保存区块' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0].html).toBe('<p><strong>更新正文</strong></p>');
  });
});

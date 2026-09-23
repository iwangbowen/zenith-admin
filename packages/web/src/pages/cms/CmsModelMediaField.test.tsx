import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button, Form } from '@douyinfe/semi-ui';
import { describe, expect, it, vi } from 'vitest';
import { mockCmsModels } from '@/mocks/data/cms';
import CmsModelMediaField from './CmsModelMediaField';

vi.mock('@/components/MediaPickerModal', () => ({ MediaPickerModal: () => null }));

describe('CMS 模型媒体字段的草稿校验', () => {
  it.each(['image', 'file'] as const)('allows manually saving a draft with an unfinished required %s field', async (fieldType) => {
    const submit = vi.fn();
    const base = mockCmsModels.flatMap((model) => model.fields ?? [])[0];
    render(<Form allowEmpty onSubmit={submit} initValues={{ extend: {} }}>
      <CmsModelMediaField field={{ ...base, name: 'document', label: '资料', fieldType, required: true }} canUpload={false} />
      <Button htmlType="submit">保存工作稿</Button>
    </Form>);
    expect(screen.getByText('资料（发布必填）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存工作稿' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].extend.document).toBeUndefined();
  });
});

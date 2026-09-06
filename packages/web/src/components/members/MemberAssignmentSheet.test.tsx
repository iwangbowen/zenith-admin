import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Toast } from '@douyinfe/semi-ui';
import { describe, expect, it, vi } from 'vitest';
import { MemberAssignmentSheet } from './MemberAssignmentSheet';

vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  return actual;
});

vi.mock('@/components/UserTransferSelect', () => ({
  UserTransferSelect: () => <div data-testid="transfer-select">transfer</div>,
}));

describe('MemberAssignmentSheet', () => {
  it('renders title and disables save when canSave is false', () => {
    render(
      <MemberAssignmentSheet
        title="成员管理 - 岗位"
        visible
        onCancel={() => {}}
        users={[{ id: 1, username: 'u1', nickname: '用户1' }]}
        value={[1]}
        onChange={() => {}}
        canSave={false}
        onSave={() => {}}
      />,
    );

    expect(screen.getByText('成员管理 - 岗位')).toBeTruthy();
    expect(screen.getByTestId('transfer-select')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('calls onSave from the save button', async () => {
    const success = vi.spyOn(Toast, 'success');
    const onSave = vi.fn(() => Promise.resolve());

    render(
      <MemberAssignmentSheet
        title="成员管理 - 用户组"
        visible
        onCancel={() => {}}
        users={[{ id: 1, username: 'u1', nickname: '用户1' }]}
        value={[]}
        onChange={() => {}}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith('保存成功');
  });
});

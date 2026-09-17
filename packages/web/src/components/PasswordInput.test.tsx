import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Form } from '@douyinfe/semi-ui';
import { describe, expect, it, vi } from 'vitest';
import { FormPasswordInput, PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('defaults to masked and toggles visibility without losing the value', () => {
    render(<PasswordInput aria-label="密码" value="secret" onChange={() => undefined} />);
    const input = screen.getByLabelText('密码');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hidden password' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hidden password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('secret');
  });

  it('preserves form registration and submitted value when toggled', async () => {
    const submit = vi.fn();
    render(<Form onSubmit={submit}>
      <FormPasswordInput field="password" label="密码" initValue="secret" rules={[{ required: true }]} />
      <button type="submit">保存</button>
    </Form>);
    const input = screen.getByLabelText('密码');
    fireEvent.change(input, { target: { value: 'updated-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ password: 'updated-secret' }), expect.anything()));
  });
});

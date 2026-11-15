import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PermissionContext } from '@/hooks/usePermission';
const state = vi.hoisted(() => ({ save: vi.fn(), diagnose: vi.fn() }));
vi.mock('@/components/settings/SettingsEditorTools', () => ({ SettingsEditorTools: () => null }));
vi.mock('@/hooks/queries/settings', async () => {
  const { ipAccessSettingsSchema } = await import('@zenith/shared/settings');
  const effective = ipAccessSettingsSchema.parse({});
  return { useSettings: () => ({ data: { module: 'ipAccess', baseToken: 'base', inherited: effective, effective, overrides: {} }, isLoading: false }),
    useSaveSettings: () => ({ mutateAsync: state.save, isPending: false }) };
});
vi.mock('@/hooks/queries/ip-access', () => ({
  useIpAccessContext: () => ({ data: { clientIp: '192.0.2.10' }, refetch: vi.fn() }),
  useDiagnoseIpAccess: () => ({ mutateAsync: state.diagnose }),
}));
import IpAccessConfig from './IpAccessConfig';

describe('IP access configuration safety', () => {
  it('shows invalid lines and disables saving a self-blocking draft', () => {
    render(<MemoryRouter><PermissionContext.Provider value={['*']}><IpAccessConfig /></PermissionContext.Provider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('白名单地址'), { target: { value: ':::' } });
    expect(screen.getByText(/第 1 行/)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存访问控制设置' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('白名单地址'), { target: { value: '198.51.100.1' } });
    fireEvent.click(screen.getAllByRole('switch')[0]);
    expect(screen.getByText(/当前草稿会阻断/)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存访问控制设置' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '加入当前 IP' }));
    expect(screen.getByRole('button', { name: '保存访问控制设置' })).toBeEnabled();
    expect(state.save).not.toHaveBeenCalled();
  });
});

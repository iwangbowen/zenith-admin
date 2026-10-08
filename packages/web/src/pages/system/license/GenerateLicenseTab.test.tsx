import { Buffer } from 'node:buffer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Toast } from '@douyinfe/semi-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LICENSE_EDITION_PRESETS, licenseEnvelopeSchema, type LicensePayload } from '@zenith/shared/licensing';

const state = vi.hoisted(() => ({
  user: { tenantId: null as number | null, roles: [{ code: 'super_admin' }] },
  canManage: true,
  sign: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => state.canManage }) }));
vi.mock('@/hooks/queries/licensing', () => ({
  useLicensingStatus: () => ({
    isLoading: false,
    data: {
      installation: { installationId: 'da721775-630c-4d31-9d0e-6b27f4d9515c' },
      usingTestKey: true,
      license: null,
    },
  }),
}));
vi.mock('./license-issuer', () => ({ signLicenseEnvelope: state.sign }));
vi.mock('@/utils/download', () => ({ downloadBlob: state.download }));

import GenerateLicenseTab from './GenerateLicenseTab';

const PRIVATE_KEY = 'temporary-private-key-never-in-output';

beforeEach(() => {
  state.user = { tenantId: null, roles: [{ code: 'super_admin' }] };
  state.canManage = true;
  state.sign.mockReset().mockImplementation(async (payload: LicensePayload, key: { keyId: string }) => ({
    version: 1,
    algorithm: 'Ed25519',
    keyId: key.keyId,
    payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    signature: 'c2lnbmF0dXJl',
  }));
  state.download.mockReset();
  vi.spyOn(Toast, 'success').mockImplementation(() => 'test-toast');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function generateLicense() {
  fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '本地签发客户' } });
  fireEvent.change(screen.getByLabelText('签发私钥'), { target: { value: PRIVATE_KEY } });
  fireEvent.click(screen.getByRole('button', { name: '生成授权文件' }));
  await screen.findByRole('button', { name: '下载 .zenlic' });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('生成授权文件页签', () => {
  it.each([
    { name: '缺少管理授权', tenantId: null, roles: [{ code: 'super_admin' }], canManage: false },
    { name: '租户内的超级管理员', tenantId: 7, roles: [{ code: 'super_admin' }], canManage: true },
    { name: '没有平台超级管理员角色', tenantId: null, roles: [{ code: 'admin' }], canManage: true },
  ])('拒绝$name，不提供私钥输入或签发入口', ({ tenantId, roles, canManage }) => {
    state.user = { tenantId, roles };
    state.canManage = canManage;
    render(<GenerateLicenseTab />);

    expect(screen.getByText('无生成权限')).toBeInTheDocument();
    expect(screen.queryByLabelText('签发私钥')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成授权文件' })).not.toBeInTheDocument();
    expect(state.sign).not.toHaveBeenCalled();
  });

  it('首次挂载就隔离私钥和显隐控制，显示私钥后仍不离开保护区域', () => {
    render(<GenerateLicenseTab />);
    const input = screen.getByLabelText('签发私钥');
    const protectedRegion = input.closest('.rr-block');
    const show = screen.getByRole('button', { name: 'Show password' });

    expect(protectedRegion).toHaveAttribute('data-sensitive');
    expect(protectedRegion).toContainElement(show);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: '生成授权文件' })).toBeDisabled();
    fireEvent.change(input, { target: { value: PRIVATE_KEY } });
    fireEvent.click(show);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue(PRIVATE_KEY);
    expect(protectedRegion).toContainElement(screen.getByRole('button', { name: 'Hidden password' }));
  });

  it('必填信息缺失时不执行本地签名', async () => {
    render(<GenerateLicenseTab />);
    fireEvent.change(screen.getByLabelText('签发私钥'), { target: { value: PRIVATE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: '生成授权文件' }));

    await screen.findByText('请输入客户名称');
    expect(state.sign).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '下载 .zenlic' })).not.toBeInTheDocument();
  });

  it('签发成功后清空私钥，仅把授权信封展示并下载为文件', async () => {
    render(<GenerateLicenseTab />);
    await generateLicense();

    expect(state.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: '本地签发客户',
        installationId: 'da721775-630c-4d31-9d0e-6b27f4d9515c',
        edition: 'pro',
        features: [...LICENSE_EDITION_PRESETS.pro],
        limits: { maxUsers: null, maxTenants: null, maxNodes: null },
      }),
      { keyId: 'test-2026', privateKey: PRIVATE_KEY },
    );
    expect(screen.getByLabelText('签发私钥')).toHaveValue('');
    expect(screen.getByRole('button', { name: '生成授权文件' })).toBeDisabled();
    const preview = screen.getByLabelText('生成的授权文件内容') as HTMLTextAreaElement;
    const envelope = licenseEnvelopeSchema.parse(JSON.parse(preview.value));
    expect(preview.value).not.toContain(PRIVATE_KEY);
    expect(envelope).not.toHaveProperty('privateKey');
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ customerName: '本地签发客户', features: [...LICENSE_EDITION_PRESETS.pro] });
    expect(payload).not.toHaveProperty('privateKey');

    fireEvent.click(screen.getByRole('button', { name: '下载 .zenlic' }));
    expect(state.download).toHaveBeenCalledOnce();
    const [blob, filename] = state.download.mock.calls[0] as [Blob, string];
    expect(filename).toMatch(/^lic_[\w.-]+\.zenlic$/);
    const downloaded = await readBlob(blob);
    expect(JSON.parse(downloaded)).toEqual(envelope);
    expect(downloaded).not.toContain(PRIVATE_KEY);
  });

  it('修改授权参数后移除旧结果，防止下载与当前表单不一致的文件', async () => {
    render(<GenerateLicenseTab />);
    await generateLicense();
    fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '另一客户' } });

    await waitFor(() => expect(screen.queryByRole('button', { name: '下载 .zenlic' })).not.toBeInTheDocument());
    expect(screen.queryByLabelText('生成的授权文件内容')).not.toBeInTheDocument();
    expect(state.download).not.toHaveBeenCalled();
  });

  it('签名失败显示固定错误，清空私钥且不产生可下载结果', async () => {
    const message = '私钥无效：请提供未加密的 Ed25519 PKCS8 base64 或 PRIVATE KEY PEM。';
    state.sign.mockRejectedValueOnce(new Error(message));
    const { container } = render(<GenerateLicenseTab />);
    fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '本地签发客户' } });
    fireEvent.change(screen.getByLabelText('签发私钥'), { target: { value: PRIVATE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: '生成授权文件' }));

    await screen.findByText(message);
    expect(screen.getByLabelText('签发私钥')).toHaveValue('');
    expect(container.textContent).not.toContain(PRIVATE_KEY);
    expect(screen.queryByRole('button', { name: '下载 .zenlic' })).not.toBeInTheDocument();
    expect(state.download).not.toHaveBeenCalled();
  });

  it('重置会同时删除签发结果与尚未使用的私钥', async () => {
    render(<GenerateLicenseTab />);
    await generateLicense();
    fireEvent.change(screen.getByLabelText('签发私钥'), { target: { value: PRIVATE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: '重置' }));

    expect(screen.getByLabelText('签发私钥')).toHaveValue('');
    await waitFor(() => expect(screen.queryByRole('button', { name: '下载 .zenlic' })).not.toBeInTheDocument());
  });
});

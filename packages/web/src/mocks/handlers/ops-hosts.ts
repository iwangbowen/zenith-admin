import { opsHostContract, type OpsHost } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';
import { notFound } from '@/mocks/utils/handlers';

let nextId = 3;
const hosts: OpsHost[] = [
  {
    id: 1,
    name: '生产应用节点',
    host: '10.0.10.21',
    port: 22,
    username: 'ops',
    authType: 'key_content',
    hasPassword: false,
    hasKeyContent: true,
    hasKeyPassphrase: false,
    hostKeyFingerprint: 'demo-fingerprint-production',
    status: 'online',
    snapshot: {
      kernel: 'Linux 6.1.0',
      osName: 'Debian GNU/Linux 12',
      uptimeSeconds: 725400,
      cpuCores: 8,
      load1: 1.2,
      memTotalBytes: 16 * 1024 ** 3,
      memUsedBytes: 9 * 1024 ** 3,
      memUsagePercent: 56,
      diskTotalBytes: 256 * 1024 ** 3,
      diskUsedBytes: 132 * 1024 ** 3,
      diskUsagePercent: 52,
    },
    probedAt: mockDateTime(),
    probeError: null,
    enabled: true,
    remark: '生产应用服务',
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
  {
    id: 2,
    name: '测试节点',
    host: '10.0.20.31',
    port: 22,
    username: 'deploy',
    authType: 'password',
    hasPassword: true,
    hasKeyContent: false,
    hasKeyPassphrase: false,
    hostKeyFingerprint: null,
    status: 'offline',
    snapshot: null,
    probedAt: mockDateTime(),
    probeError: 'SSH 连接超时',
    enabled: true,
    remark: null,
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
];

function findHost(id: number) {
  return hosts.find((item) => item.id === id);
}

export const opsHostHandlers = [
  mock(opsHostContract.list, ({ ok }) => ok(hosts)),
  mock(opsHostContract.probeAll, ({ ok }) => ok(hosts)),
  mock(opsHostContract.importSshProfile, ({ params, ok }) => {
    const id = params.profileId;
    const now = mockDateTime();
    const host: OpsHost = {
      id: nextId++,
      name: `SSH 配置 ${id}`,
      host: `ssh-${id}.example.internal`,
      port: 22,
      username: 'ops',
      authType: 'key_content',
      hasPassword: false,
      hasKeyContent: true,
      hasKeyPassphrase: false,
      hostKeyFingerprint: null,
      status: 'unknown',
      snapshot: null,
      probedAt: null,
      probeError: null,
      enabled: true,
      remark: `从 SSH 配置 ${id} 导入`,
      createdAt: now,
      updatedAt: now,
    };
    hosts.unshift(host);
    return ok(host, '已导入');
  }),
  mock(opsHostContract.detail, ({ params, ok }) => {
    const host = findHost(params.id);
    return host ? ok(host) : notFound('主机不存在', { status: 404 });
  }),
  mock(opsHostContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const host: OpsHost = {
      id: nextId++,
      name: body.name,
      host: body.host,
      port: body.port,
      username: body.username,
      authType: body.authType,
      hasPassword: !!body.password,
      hasKeyContent: !!body.keyContent,
      hasKeyPassphrase: !!body.keyPassphrase,
      hostKeyFingerprint: null,
      status: 'unknown',
      snapshot: null,
      probedAt: null,
      probeError: null,
      enabled: body.enabled,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    hosts.unshift(host);
    return ok(host, '已创建');
  }),
  mock(opsHostContract.update, ({ params, body, ok }) => {
    const index = hosts.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('主机不存在', { status: 404 });
    const current = hosts[index];
    hosts[index] = {
      ...current,
      name: body.name ?? current.name,
      host: body.host ?? current.host,
      port: body.port ?? current.port,
      username: body.username ?? current.username,
      authType: body.authType ?? current.authType,
      hasPassword: body.password ? true : current.hasPassword,
      hasKeyContent: body.keyContent ? true : current.hasKeyContent,
      hasKeyPassphrase: body.keyPassphrase ? true : current.hasKeyPassphrase,
      enabled: body.enabled ?? current.enabled,
      remark: body.remark === undefined ? current.remark : body.remark,
      updatedAt: mockDateTime(),
    };
    return ok(hosts[index], '已更新');
  }),
  mock(opsHostContract.remove, ({ params, ok }) => {
    const index = hosts.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('主机不存在', { status: 404 });
    hosts.splice(index, 1);
    return ok(null, '已删除');
  }),
  mock(opsHostContract.test, ({ params, ok }) => {
    const host = findHost(params.id);
    return host
      ? ok({ ok: host.status !== 'offline', message: host.status === 'offline' ? 'SSH 连接超时' : '连接成功', latencyMs: host.status === 'offline' ? null : 32 })
      : notFound('主机不存在', { status: 404 });
  }),
  mock(opsHostContract.probe, ({ params, ok }) => {
    const host = findHost(params.id);
    return host ? ok(host) : notFound('主机不存在', { status: 404 });
  }),
  mock(opsHostContract.resetHostKey, ({ params, ok }) => {
    const host = findHost(params.id);
    if (!host) return notFound('主机不存在', { status: 404 });
    host.hostKeyFingerprint = null;
    return ok(null, '已重置');
  }),
];

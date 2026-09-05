import { firewallContract, type FirewallRule, type FirewallStatus } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';

const mockStatus: FirewallStatus = {
  enabled: true,
  type: 'ufw',
  version: '0.36.1',
  defaultIncoming: 'deny',
  defaultOutgoing: 'allow',
};

const mockRules: FirewallRule[] = [
  { id: '1', type: 'allow', protocol: 'tcp', port: '22', from: 'any', to: 'any', direction: 'in', comment: 'SSH' },
  { id: '2', type: 'allow', protocol: 'tcp', port: '80', from: 'any', to: 'any', direction: 'in', comment: 'HTTP' },
  { id: '3', type: 'allow', protocol: 'tcp', port: '443', from: 'any', to: 'any', direction: 'in', comment: 'HTTPS' },
  { id: '4', type: 'allow', protocol: 'tcp', port: '3000', from: '127.0.0.1', to: 'any', direction: 'in', comment: 'Node Dev' },
  { id: '5', type: 'deny', protocol: 'any', port: 'any', from: '192.168.1.100', to: 'any', direction: 'in', comment: null },
];

export const firewallHandlers = [
  mock(firewallContract.status, ({ ok }) => ok(mockStatus)),
  mock(firewallContract.rules, ({ ok }) => ok({ type: 'ufw', rules: mockRules })),
  // body 已按契约补齐 from / to / direction 默认值
  mock(firewallContract.addRule, ({ body, ok }) => {
    mockRules.push({
      id: String(Date.now()),
      type: body.type,
      protocol: body.protocol,
      port: body.port,
      from: body.from,
      to: body.to,
      direction: body.direction,
      comment: body.comment ?? null,
    });
    return ok(null, '规则已添加');
  }),
  mock(firewallContract.removeRule, ({ params, ok }) => {
    const idx = mockRules.findIndex((rule) => rule.id === params.id);
    if (idx !== -1) mockRules.splice(idx, 1);
    return ok(null, '规则已删除');
  }),
  mock(firewallContract.enable, ({ ok }) => {
    mockStatus.enabled = true;
    return ok(null, '防火墙已启用');
  }),
  mock(firewallContract.disable, ({ ok }) => {
    mockStatus.enabled = false;
    return ok(null, '防火墙已关闭');
  }),
];

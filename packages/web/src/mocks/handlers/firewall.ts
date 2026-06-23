import { http, HttpResponse } from 'msw';

const mockStatus = {
  enabled: true,
  type: 'ufw',
  version: '0.36.1',
  defaultIncoming: 'deny',
  defaultOutgoing: 'allow',
};

interface MockRule {
  id: string;
  type: 'allow' | 'deny' | 'reject';
  protocol: 'tcp' | 'udp' | 'any';
  port: string;
  from: string;
  to: string;
  direction: 'in' | 'out' | 'any';
  comment: string | null;
}

const mockRules: MockRule[] = [
  { id: '1', type: 'allow', protocol: 'tcp', port: '22', from: 'any', to: 'any', direction: 'in', comment: 'SSH' },
  { id: '2', type: 'allow', protocol: 'tcp', port: '80', from: 'any', to: 'any', direction: 'in', comment: 'HTTP' },
  { id: '3', type: 'allow', protocol: 'tcp', port: '443', from: 'any', to: 'any', direction: 'in', comment: 'HTTPS' },
  { id: '4', type: 'allow', protocol: 'tcp', port: '3000', from: '127.0.0.1', to: 'any', direction: 'in', comment: 'Node Dev' },
  { id: '5', type: 'deny', protocol: 'any', port: 'any', from: '192.168.1.100', to: 'any', direction: 'in', comment: null },
];

export const firewallHandlers = [
  http.get('/api/firewall', () => HttpResponse.json({ code: 0, message: 'ok', data: mockStatus })),
  http.get('/api/firewall/rules', () => HttpResponse.json({ code: 0, message: 'ok', data: { type: 'ufw', rules: mockRules } })),
  http.post('/api/firewall/rules', async ({ request }) => {
    const body = await request.json() as Partial<MockRule>;
    const newRule: MockRule = {
      id: String(Date.now()),
      type: body.type ?? 'allow',
      protocol: body.protocol ?? 'tcp',
      port: body.port ?? '80',
      from: body.from ?? 'any',
      to: body.to ?? 'any',
      direction: body.direction ?? 'in',
      comment: body.comment ?? null,
    };
    mockRules.push(newRule);
    return HttpResponse.json({ code: 0, message: '规则已添加', data: null });
  }),
  http.delete('/api/firewall/rules/:id', ({ params }) => {
    const idx = mockRules.findIndex((rule) => rule.id === params.id);
    if (idx !== -1) mockRules.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '规则已删除', data: null });
  }),
  http.post('/api/firewall/enable', () => {
    mockStatus.enabled = true;
    return HttpResponse.json({ code: 0, message: '防火墙已启用', data: null });
  }),
  http.post('/api/firewall/disable', () => {
    mockStatus.enabled = false;
    return HttpResponse.json({ code: 0, message: '防火墙已关闭', data: null });
  }),
];

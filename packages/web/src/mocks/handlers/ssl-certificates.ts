import { http, HttpResponse } from 'msw';
import { mockDateTime } from '../utils/date';

interface MockCert {
  id: number;
  name: string;
  domain: string;
  type: 'self_signed' | 'uploaded' | 'letsencrypt';
  certPath: string | null;
  keyPath: string | null;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  serialNumber: string | null;
  status: 'valid' | 'expiring' | 'expired' | 'invalid';
  autoRenew: boolean;
  daysRemaining: number | null;
  createdAt: string;
  updatedAt: string;
}

const mockCerts: MockCert[] = [
  {
    id: 1,
    name: 'example.com 证书',
    domain: 'example.com',
    type: 'uploaded',
    certPath: '/etc/ssl/zenith/1/cert.pem',
    keyPath: '/etc/ssl/zenith/1/key.pem',
    issuer: 'CN=Let\'s Encrypt Authority X3',
    subject: 'CN=example.com',
    validFrom: '2024-01-01 00:00:00',
    validTo: '2027-01-01 00:00:00',
    fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33',
    serialNumber: '03:AB:12:34:56:78',
    status: 'valid',
    autoRenew: true,
    daysRemaining: 200,
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
  {
    id: 2,
    name: 'api.example.com 自签名',
    domain: 'api.example.com',
    type: 'self_signed',
    certPath: '/etc/ssl/zenith/2/cert.pem',
    keyPath: '/etc/ssl/zenith/2/key.pem',
    issuer: 'CN=api.example.com',
    subject: 'CN=api.example.com',
    validFrom: '2024-01-01 00:00:00',
    validTo: '2026-07-08 00:00:00',
    fingerprint: '11:22:33:44:55:66:77:88',
    serialNumber: '01:23:45:67:89:AB',
    status: 'expiring',
    autoRenew: false,
    daysRemaining: 15,
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
  {
    id: 3,
    name: 'old.example.com 过期',
    domain: 'old.example.com',
    type: 'uploaded',
    certPath: '/etc/ssl/zenith/3/cert.pem',
    keyPath: '/etc/ssl/zenith/3/key.pem',
    issuer: 'CN=DigiCert CA',
    subject: 'CN=old.example.com',
    validFrom: '2023-01-01 00:00:00',
    validTo: '2023-12-31 00:00:00',
    fingerprint: 'AA:BB:CC:11:22:33:44:55',
    serialNumber: 'FF:EE:DD:CC:BB:AA',
    status: 'expired',
    autoRenew: false,
    daysRemaining: -50,
    createdAt: '2023-01-01 00:00:00',
    updatedAt: '2023-01-01 00:00:00',
  },
];

let nextId = 4;

export const sslCertificatesHandlers = [
  http.get('/api/ssl-certificates', ({ request }) => {
    const url = new URL(request.url);
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    const type = url.searchParams.get('type') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
    const filtered = mockCerts.filter((cert) => {
      const matchesKeyword = !keyword || cert.name.toLowerCase().includes(keyword) || cert.domain.toLowerCase().includes(keyword);
      const matchesType = !type || cert.type === type;
      return matchesKeyword && matchesType;
    });
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        list: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
      },
    });
  }),
  http.get('/api/ssl-certificates/:id', ({ params }) => {
    const cert = mockCerts.find((item) => item.id === Number(params.id));
    if (!cert) {
      return HttpResponse.json({ code: 404, message: '证书不存在', data: null }, { status: 404 });
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: cert });
  }),
  http.get('/api/ssl-certificates/:id/download', ({ params, request }) => {
    const cert = mockCerts.find((item) => item.id === Number(params.id));
    if (!cert) {
      return HttpResponse.json({ code: 404, message: '证书不存在', data: null }, { status: 404 });
    }
    const kind = new URL(request.url).searchParams.get('kind') === 'key' ? 'key' : 'cert';
    const content = kind === 'cert'
      ? `-----BEGIN CERTIFICATE-----\nMOCK-${cert.domain}\n-----END CERTIFICATE-----\n`
      : `-----BEGIN PRIVATE KEY-----\nMOCK-${cert.domain}\n-----END PRIVATE KEY-----\n`;
    return HttpResponse.text(content, {
      headers: {
        'Content-Type': kind === 'cert' ? 'application/x-x509-ca-cert' : 'application/x-pem-file',
        'Content-Disposition': `attachment; filename="${cert.domain}-${kind}.pem"`,
      },
    });
  }),
  http.post('/api/ssl-certificates/generate', async ({ request }) => {
    const body = await request.json() as { name: string; domain: string; days?: number };
    const daysRemaining = body.days ?? 365;
    const id = nextId++;
    const cert: MockCert = {
      id,
      name: body.name,
      domain: body.domain,
      type: 'self_signed',
      certPath: `/etc/ssl/zenith/${id}/cert.pem`,
      keyPath: `/etc/ssl/zenith/${id}/key.pem`,
      issuer: `CN=${body.domain}`,
      subject: `CN=${body.domain}`,
      validFrom: mockDateTime(),
      validTo: mockDateTime(Date.now() + daysRemaining * 86400000),
      fingerprint: 'AA:BB:CC:DD:EE:FF:11:22',
      serialNumber: '01:23:45:67',
      status: daysRemaining <= 30 ? 'expiring' : 'valid',
      autoRenew: false,
      daysRemaining,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCerts.unshift(cert);
    return HttpResponse.json({ code: 0, message: '证书已生成', data: { id: cert.id } });
  }),
  http.post('/api/ssl-certificates/upload', async ({ request }) => {
    const body = await request.json() as { name: string; domain: string };
    const id = nextId++;
    const cert: MockCert = {
      id,
      name: body.name,
      domain: body.domain,
      type: 'uploaded',
      certPath: `/etc/ssl/zenith/${id}/cert.pem`,
      keyPath: `/etc/ssl/zenith/${id}/key.pem`,
      issuer: 'CN=Uploaded CA',
      subject: `CN=${body.domain}`,
      validFrom: mockDateTime(),
      validTo: '2027-12-31 00:00:00',
      fingerprint: '12:34:56:78:9A:BC',
      serialNumber: 'AB:CD:EF',
      status: 'valid',
      autoRenew: false,
      daysRemaining: 300,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCerts.unshift(cert);
    return HttpResponse.json({ code: 0, message: '证书已上传', data: { id: cert.id } });
  }),
  http.delete('/api/ssl-certificates/:id', ({ params }) => {
    const index = mockCerts.findIndex((item) => item.id === Number(params.id));
    if (index !== -1) {
      mockCerts.splice(index, 1);
    }
    return HttpResponse.json({ code: 0, message: '证书已删除', data: null });
  }),
];

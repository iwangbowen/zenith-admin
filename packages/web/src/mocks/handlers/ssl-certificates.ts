import { HttpResponse } from 'msw';
import { sslCertificateContract, type SslCertificate } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';

const mockCerts: SslCertificate[] = [
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

export const sslCertificatesHandlers = [
  mock(sslCertificateContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    const filtered = mockCerts.filter((cert) => {
      const matchesKeyword = !keyword || cert.name.toLowerCase().includes(keyword) || cert.domain.toLowerCase().includes(keyword);
      const matchesType = !query.type || cert.type === query.type;
      return matchesKeyword && matchesType;
    });
    return ok(paginate(filtered));
  }),
  mock(sslCertificateContract.detail, ({ params, ok }) => {
    const cert = mockCerts.find((item) => item.id === params.id);
    if (!cert) return notFound('证书不存在', { status: 404 });
    return ok(cert);
  }),
  mock(sslCertificateContract.download, ({ params, query }) => {
    const cert = mockCerts.find((item) => item.id === params.id);
    if (!cert) return notFound('证书不存在', { status: 404 });
    const kind = query.kind === 'key' ? 'key' : 'cert';
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
  mock(sslCertificateContract.generate, ({ body, ok }) => {
    const daysRemaining = body.days;
    const id = nextIdFrom(mockCerts);
    const cert: SslCertificate = {
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
    return ok({ id: cert.id }, '证书已生成');
  }),
  mock(sslCertificateContract.upload, ({ body, ok }) => {
    const id = nextIdFrom(mockCerts);
    const cert: SslCertificate = {
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
    return ok({ id: cert.id }, '证书已上传');
  }),
  mock(sslCertificateContract.remove, ({ params, ok }) => {
    const index = mockCerts.findIndex((item) => item.id === params.id);
    if (index !== -1) {
      mockCerts.splice(index, 1);
    }
    return ok(null, '证书已删除');
  }),
];

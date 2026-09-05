import { nginxSiteContract, type NginxInfo, type NginxSite } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';

const mockInfo: NginxInfo = {
  installed: true,
  version: '1.24.0',
  configPath: '/etc/nginx/nginx.conf',
  sitesAvailable: '/etc/nginx/sites-available',
  sitesEnabled: '/etc/nginx/sites-enabled',
  runningStatus: 'running',
};

const mockSites: NginxSite[] = [
  { name: 'default', enabled: true, configPath: '/etc/nginx/sites-available/default', serverName: '_', listenPort: 80, root: '/var/www/html', sslEnabled: false, accessLog: '/var/log/nginx/access.log', errorLog: '/var/log/nginx/error.log', createdAt: '2024-01-01 00:00:00', updatedAt: '2024-01-01 00:00:00' },
  { name: 'example.com', enabled: true, configPath: '/etc/nginx/sites-available/example.com', serverName: 'example.com www.example.com', listenPort: 443, root: '/var/www/example.com', sslEnabled: true, accessLog: '/var/log/nginx/example.com.access.log', errorLog: '/var/log/nginx/example.com.error.log', createdAt: '2024-03-15 10:00:00', updatedAt: '2024-03-15 10:00:00' },
  { name: 'api.example.com', enabled: false, configPath: '/etc/nginx/sites-available/api.example.com', serverName: 'api.example.com', listenPort: 80, root: null, sslEnabled: false, accessLog: null, errorLog: null, createdAt: '2024-05-01 08:00:00', updatedAt: '2024-05-01 08:00:00' },
];

const mockConfig = `server {
    listen 80;
    server_name example.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}`;

export const nginxSitesHandlers = [
  mock(nginxSiteContract.info, ({ ok }) => ok(mockInfo)),
  mock(nginxSiteContract.list, ({ ok }) => ok(mockSites)),
  mock(nginxSiteContract.detail, ({ params, ok }) => {
    const site = mockSites.find((s) => s.name === params.name);
    if (!site) return notFound('站点不存在', { status: 404 });
    return ok({ ...site, content: mockConfig });
  }),
  mock(nginxSiteContract.create, ({ body, ok }) => {
    mockSites.push({
      name: body.name,
      enabled: false,
      configPath: `/etc/nginx/sites-available/${body.name}`,
      serverName: body.serverName,
      listenPort: body.listenPort,
      root: body.root ?? null,
      sslEnabled: body.sslEnabled,
      accessLog: null,
      errorLog: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    });
    return ok(null, '站点已创建');
  }),
  mock(nginxSiteContract.update, ({ ok }) => ok(null, '配置已保存')),
  mock(nginxSiteContract.remove, ({ params, ok }) => {
    const idx = mockSites.findIndex((s) => s.name === params.name);
    if (idx !== -1) mockSites.splice(idx, 1);
    return ok(null, '站点已删除');
  }),
  mock(nginxSiteContract.enable, ({ params, ok }) => {
    const site = mockSites.find((s) => s.name === params.name);
    if (site) site.enabled = true;
    return ok(null, '站点已启用');
  }),
  mock(nginxSiteContract.disable, ({ params, ok }) => {
    const site = mockSites.find((s) => s.name === params.name);
    if (site) site.enabled = false;
    return ok(null, '站点已禁用');
  }),
  mock(nginxSiteContract.test, ({ ok }) => ok({ success: true, output: 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful' })),
  mock(nginxSiteContract.reload, ({ ok }) => ok(null, 'Nginx 已重载')),
];

/**
 * 运维 / 系统基建小域的缓存一致性契约（nginx / firewall / systemd / maintenance / db-admin / login-logs /
 * licensing / sessions / retention / ssl / export-jobs）
 *
 * 这些域收敛前都以 `xxxKeys.all` 域根广播失效；契约 key 的资源键是整串（如 `'nginx-sites'`），
 * 字面量根前缀有的还能匹配、有的（如 `['terminal']`）已经匹配不到任何查询。收敛后每个写操作只失效真实副作用面：
 * 「改动 A 后，列表 B 回源、无关查询 C 不回源」逐域各断言一条。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ExportJob } from '@zenith/shared/tasks';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { nginxSiteKeys, useNginxSiteAction, useNginxSiteDetail, useNginxSitesOverview, useReloadNginx, useUpdateNginxSite } from './nginx-sites';
import { firewallKeys, useEnableFirewall, useFirewallRules, useFirewallStatus } from './firewall';
import { serviceKeys, useServiceAction, useServiceList } from './services';
import { maintenanceKeys, useMaintenanceLogs, useMaintenanceStatus, usePublicMaintenanceStatus, useUpdateMaintenanceStatus } from './maintenance';
import { dbAdminKeys, useDbAdminActivity, useDbAdminMaintenance, useDbAdminObjects, useDbAdminOverview, useDbAdminRefreshMatview, useDbAdminTables } from './db-admin';
import { loginLogKeys, useCleanLoginLogs, useLoginLogList, useLoginLogStats } from './login-logs';
import { licensingKeys, useDeactivateLicense, useLicenseEvents, useLicensingStatus } from './licensing';
import { sessionKeys, useForceLogoutSession, useSessionList } from './sessions';
import { retentionKeys, useRetentionPolicies, useRunRetentionPolicy } from './retention';
import { sslCertificateKeys, useGenerateSslCertificate, useSslCertificateDetail, useSslCertificateList } from './ssl-certificates';
import { exportJobKeys, rerunExportJobBody, useExportEntities, useExportJobDownloads, useExportJobList, useRerunExportJob } from './export-jobs';

const PAGE = { page: 1, pageSize: 10 };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    // nginx
    .on('GET', '/api/nginx-sites/info', { installed: true, version: '1.24' })
    .on('GET', '/api/nginx-sites', [{ name: 'default', enabled: true }])
    .on('GET', '/api/nginx-sites/default', { name: 'default', content: 'server {}' })
    .on('GET', '/api/nginx-sites/other', { name: 'other', content: 'server {}' })
    .on('PUT', '/api/nginx-sites/default', null)
    .on('POST', '/api/nginx-sites/default/disable', null)
    .on('DELETE', '/api/nginx-sites/default', null)
    .on('POST', '/api/nginx-sites/reload', null)
    // firewall
    .on('GET', '/api/firewall', { enabled: false, ruleCount: 0 })
    .on('GET', '/api/firewall/rules', [])
    .on('POST', '/api/firewall/enable', null)
    // systemd
    .on('GET', '/api/systemd/check', { available: true })
    .on('GET', '/api/systemd', [])
    .on('POST', '/api/systemd/nginx/restart', null)
    // maintenance
    .on('GET', '/api/maintenance/status', { enabled: false })
    .on('GET', '/api/maintenance', { enabled: false })
    .on('GET', '/api/maintenance/logs', EMPTY_PAGE)
    .on('PUT', '/api/maintenance', { enabled: true })
    // db-admin
    .on('GET', '/api/db-admin/tables', [])
    .on('GET', '/api/db-admin/overview', { size: '1 MB' })
    .on('GET', '/api/db-admin/maintenance/tables', [])
    .on('GET', '/api/db-admin/activity', [])
    .on('GET', '/api/db-admin/objects', { sequences: [], functions: [], triggers: [], enums: [], extensions: [] })
    .on('POST', '/api/db-admin/tables/public/mv_stats/refresh', null)
    // login-logs
    .on('GET', '/api/login-logs', EMPTY_PAGE)
    .on('GET', '/api/login-logs/stats', { total: 0 })
    .on('DELETE', '/api/login-logs/clean', null)
    // licensing
    .on('GET', '/api/licensing/status', { active: true })
    .on('GET', '/api/licensing/events', EMPTY_PAGE)
    .on('POST', '/api/licensing/deactivate', null)
    // sessions
    .on('GET', '/api/sessions', EMPTY_PAGE)
    .on('DELETE', '/api/sessions/tok-1', null)
    // retention
    .on('GET', '/api/retention-policies', [])
    .on('POST', '/api/retention-policies/login_logs/run', { deleted: 0 })
    // ssl
    .on('GET', '/api/ssl-certificates', EMPTY_PAGE)
    .on('GET', '/api/ssl-certificates/1', { id: 1, name: 'a' })
    .on('POST', '/api/ssl-certificates/generate', { id: 2 })
    // export-jobs
    .on('GET', '/api/export-jobs/entities', [])
    .on('GET', '/api/export-jobs', EMPTY_PAGE)
    .on('GET', '/api/export-jobs/9/downloads', [])
    .on('POST', '/api/export-jobs', { mode: 'async', jobId: 10 });
});

describe('nginx-sites', () => {
  it('updating a site refreshes the overview and that site detail, leaving other site details fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ overview: useNginxSitesOverview(), detail: useNginxSiteDetail('default'), other: useNginxSiteDetail('other'), update: useUpdateNginxSite() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.overview.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.other.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.update.mutateAsync({ params: { name: 'default' }, body: { content: 'server { listen 80; }' } });
    await waitFor(() => {
      expect(fetches.countOf(nginxSiteKeys.overview)).toBe(1);
      expect(fetches.countOf(nginxSiteKeys.detail('default'))).toBe(1);
    });

    expect(fetches.countOf(nginxSiteKeys.detail('other'))).toBe(0);
    expect(isFresh(qc, nginxSiteKeys.detail('other'))).toBe(true);
    fetches.stop();
  });

  it('deleting a site drops its detail cache instead of refetching it; reload only refreshes the overview', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ overview: useNginxSitesOverview(), other: useNginxSiteDetail('other'), action: useNginxSiteAction(), reload: useReloadNginx() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.overview.isSuccess).toBe(true);
      expect(result.current.other.isSuccess).toBe(true);
    });
    qc.setQueryData(nginxSiteKeys.detail('default'), { name: 'default', content: '' });
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.action.mutateAsync({ name: 'default', action: 'delete' });
    await waitFor(() => expect(fetches.countOf(nginxSiteKeys.overview)).toBe(1));
    expect(hasCacheEntry(qc, nginxSiteKeys.detail('default'))).toBe(false);
    expect(api.countOf('GET', '/api/nginx-sites/default')).toBe(0);

    await result.current.reload.mutateAsync({});
    await waitFor(() => expect(fetches.countOf(nginxSiteKeys.overview)).toBe(2));
    expect(fetches.countOf(nginxSiteKeys.detail('other'))).toBe(0);
    fetches.stop();
  });
});

describe('firewall', () => {
  it('enabling the firewall refreshes both the status panel and the rule list', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ status: useFirewallStatus(), rules: useFirewallRules(), enable: useEnableFirewall() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.status.isSuccess).toBe(true);
      expect(result.current.rules.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);

    await result.current.enable.mutateAsync({ query: {} });
    await waitFor(() => {
      expect(fetches.countOf(firewallKeys.statuses)).toBe(1);
      expect(fetches.countOf(firewallKeys.lists)).toBe(1);
    });
    fetches.stop();
  });
});

describe('systemd', () => {
  it('controlling a service on one host refreshes that host list only', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ local: useServiceList(null), remote: useServiceList(1), action: useServiceAction() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.local.isSuccess).toBe(true);
      expect(result.current.remote.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);

    await result.current.action.mutateAsync({ params: { name: 'nginx', action: 'restart' }, query: { hostId: 1 } });
    await waitFor(() => expect(fetches.countOf(serviceKeys.list(1))).toBe(1));

    expect(fetches.countOf(serviceKeys.list(null), { exact: true })).toBe(0);
    expect(isFresh(qc, serviceKeys.list(null))).toBe(true);
    fetches.stop();
  });
});

describe('maintenance', () => {
  it('toggling maintenance refreshes the public status, the admin detail and the logs', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ pub: usePublicMaintenanceStatus(), detail: useMaintenanceStatus(), logs: useMaintenanceLogs(PAGE), update: useUpdateMaintenanceStatus() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.pub.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.logs.isSuccess).toBe(true);
    });
    // App.tsx / 超管横幅按 maintenanceKeys.publicStatus 失效，公开状态 hook 的 key 必须落在该前缀下
    expect(hasCacheEntry(qc, maintenanceKeys.publicStatus)).toBe(true);
    const fetches = observeFetches(qc);

    await result.current.update.mutateAsync({ body: { enabled: true, message: '维护中' } });
    await waitFor(() => {
      expect(fetches.countOf(maintenanceKeys.publicStatus)).toBe(1);
      expect(fetches.countOf(maintenanceKeys.status)).toBe(1);
      expect(fetches.countOf(maintenanceKeys.logs)).toBe(1);
    });
    fetches.stop();
  });
});

describe('db-admin refreshMatview', () => {
  it('refreshes tables / overview / maintenance stats but leaves activity and objects fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        tables: useDbAdminTables(), overview: useDbAdminOverview(), maintenance: useDbAdminMaintenance(),
        activity: useDbAdminActivity(false), objects: useDbAdminObjects(), refresh: useDbAdminRefreshMatview(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.tables.isSuccess).toBe(true);
      expect(result.current.overview.isSuccess).toBe(true);
      expect(result.current.maintenance.isSuccess).toBe(true);
      expect(result.current.activity.isSuccess).toBe(true);
      expect(result.current.objects.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);

    await result.current.refresh.mutateAsync({ params: { schema: 'public', name: 'mv_stats' } });
    await waitFor(() => {
      expect(fetches.countOf(dbAdminKeys.tables)).toBe(1);
      expect(fetches.countOf(dbAdminKeys.overview)).toBe(1);
      expect(fetches.countOf(dbAdminKeys.maintenance)).toBe(1);
    });

    expect(fetches.countOf(dbAdminKeys.activity)).toBe(0);
    expect(fetches.countOf(dbAdminKeys.objects)).toBe(0);
    expect(isFresh(qc, dbAdminKeys.objects)).toBe(true);
    fetches.stop();
  });
});

describe('login-logs / licensing / sessions / retention / ssl —— 域内全部查询按操作前缀逐个失效', () => {
  it('cleaning login logs refreshes the list and the stats panel', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useLoginLogList(PAGE), stats: useLoginLogStats({ days: 7 }), clean: useCleanLoginLogs() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.stats.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);

    await result.current.clean.mutateAsync({ query: { days: 90 } });
    await waitFor(() => {
      expect(fetches.countOf(loginLogKeys.lists)).toBe(1);
      expect(fetches.countOf(loginLogKeys.stats)).toBe(1);
    });
    fetches.stop();
  });

  it('deactivating a license refreshes the status and the event log', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ status: useLicensingStatus(), events: useLicenseEvents(PAGE), deactivate: useDeactivateLicense() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.status.isSuccess).toBe(true);
      expect(result.current.events.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);

    await result.current.deactivate.mutateAsync({});
    await waitFor(() => {
      expect(fetches.countOf(licensingKeys.status)).toBe(1);
      expect(fetches.countOf(licensingKeys.events)).toBe(1);
    });
    fetches.stop();
  });

  it('forcing a session offline refreshes the online session list', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({ list: useSessionList(PAGE), kick: useForceLogoutSession() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const fetches = observeFetches(qc);

    await result.current.kick.mutateAsync({ params: { tokenId: 'tok-1' } });
    await waitFor(() => expect(fetches.countOf(sessionKeys.lists)).toBe(1));
    fetches.stop();
  });

  it('running a retention policy refreshes the policy list', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({ list: useRetentionPolicies(), run: useRunRetentionPolicy() }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const fetches = observeFetches(qc);

    await result.current.run.mutateAsync({ params: { key: 'login_logs' } });
    await waitFor(() => expect(fetches.countOf(retentionKeys.list)).toBe(1));
    fetches.stop();
  });

  it('generating a certificate refreshes the list but leaves existing certificate details fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useSslCertificateList(PAGE), detail: useSslCertificateDetail(1), generate: useGenerateSslCertificate() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);

    await result.current.generate.mutateAsync({ body: { name: 'a', domain: 'example.com' } });
    await waitFor(() => expect(fetches.countOf(sslCertificateKeys.lists)).toBe(1));

    expect(fetches.countOf(sslCertificateKeys.detail(1))).toBe(0);
    expect(isFresh(qc, sslCertificateKeys.detail(1))).toBe(true);
    fetches.stop();
  });
});

describe('export-jobs rerun', () => {
  it('re-submitting a job refreshes the list only; entities and the source job downloads stay fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ list: useExportJobList(PAGE), entities: useExportEntities(), downloads: useExportJobDownloads(9), rerun: useRerunExportJob() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.entities.isSuccess).toBe(true);
      expect(result.current.downloads.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);
    api.resetCalls();

    const record = { id: 9, entity: 'users', format: 'csv', query: { keyword: 'a' }, columns: null, raw: false, watermark: true, executionMode: 'sync' } as unknown as ExportJob;
    await result.current.rerun.mutateAsync({ body: rerunExportJobBody(record), sourceId: record.id });
    await waitFor(() => expect(fetches.countOf(exportJobKeys.lists)).toBe(1));

    // sourceId 只供页面标记行级忙碌态，不进请求体
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ entity: 'users', format: 'csv', query: { keyword: 'a' }, columns: undefined, raw: false, watermark: true, executionMode: 'sync' });
    expect(fetches.countOf(exportJobKeys.entities)).toBe(0);
    expect(fetches.countOf(exportJobKeys.downloads(9))).toBe(0);
    expect(isFresh(qc, exportJobKeys.downloads(9))).toBe(true);
    fetches.stop();
  });
});

/**
 * report-governance 域缓存一致性契约
 *
 * 治理动作此前只回源治理列表自身：审批通过 / 转移接受在服务端改写的是被治理资源
 * （lifecycleStatus / revision / ownerId），资源列表与资产目录会静默显示旧值。
 * 收窄后按资源类型精确触达所有者域，拒绝 / 取消不碰任何资源查询。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
  type RecordedCall,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  reportAclKeys,
  reportApprovalKeys,
  reportTransferKeys,
  useDecideReportApproval,
  useDecideReportTransfer,
  useGrantReportResourceAcl,
  useReportApprovalList,
  useReportResourceAcls,
  useReportTransferList,
} from './report-governance';
import { reportDashboardKeys, useReportDashboardList } from './report-dashboards';
import { reportAssetKeys, useReportAssetCatalog } from './report-assets';
import { reportDatasetKeys } from './report-datasets';

const PAGE = { page: 1, pageSize: 10 };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };
const ACL_PARAMS = { resourceType: 'dashboard' as const, resourceId: 7, inheritFromFolder: true };
const APPROVAL = { id: 1, resourceType: 'dashboard', resourceId: 7, action: 'publish', status: 'pending', requestedRevision: 1 };
const TRANSFER = { id: 1, resourceType: 'dataset', resourceId: 3, status: 'pending', fromOwnerId: 1, toOwnerId: 2 };
/** 看板 7 的 published 模式取数：审批通过发布后必须回源 */
const DATA_KEY_7 = reportDashboardKeys.dashboardData(7, 'published', { filters: {}, limit: 500 });
const DATA_KEY_8 = reportDashboardKeys.dashboardData(8, 'published', { filters: {}, limit: 500 });

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/report/governance/approvals', EMPTY_PAGE)
    .on('GET', '/api/report/governance/transfers', EMPTY_PAGE)
    .on('GET', '/api/report/governance/acls', [])
    .on('GET', '/api/report/dashboards', EMPTY_PAGE)
    .on('GET', '/api/report/assets/catalog', EMPTY_PAGE)
    .on('POST', '/api/report/governance/approvals/1/decision', (call: RecordedCall) => ({ ...APPROVAL, status: (call.body as { decision: string }).decision }))
    .on('POST', '/api/report/governance/transfers/1/decision', (call: RecordedCall) => ({ ...TRANSFER, status: (call.body as { decision: string }).decision }))
    .on('POST', '/api/report/governance/acls', { id: 11, ...ACL_PARAMS, subjectType: 'user', subjectId: 1, role: 'viewer' });
});

function mountGovernanceScreen() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      approvals: useReportApprovalList(PAGE),
      transfers: useReportTransferList(PAGE),
      acls: useReportResourceAcls(ACL_PARAMS),
      dashboards: useReportDashboardList(PAGE),
      catalog: useReportAssetCatalog({ page: 1, pageSize: 100, types: 'dashboard' }),
      decideApproval: useDecideReportApproval(),
      decideTransfer: useDecideReportTransfer(),
      grantAcl: useGrantReportResourceAcl(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, ...hook };
}

async function settled(result: ReturnType<typeof mountGovernanceScreen>['result']) {
  await waitFor(() => {
    expect(result.current.approvals.isSuccess).toBe(true);
    expect(result.current.transfers.isSuccess).toBe(true);
    expect(result.current.acls.isSuccess).toBe(true);
    expect(result.current.dashboards.isSuccess).toBe(true);
    expect(result.current.catalog.isSuccess).toBe(true);
  });
}

describe('useDecideReportApproval', () => {
  it('通过看板发布审批：审批列表、看板列表、资产目录与该看板取数回源，权限 / 转移列表不动', async () => {
    const { qc, result } = mountGovernanceScreen();
    await settled(result);
    qc.setQueryData(DATA_KEY_7, {});
    qc.setQueryData(DATA_KEY_8, {});

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.decideApproval.mutateAsync({ params: { id: 1 }, body: { decision: 'approved' } });
    await waitFor(() => expect(fetches.countOf(reportApprovalKeys.all)).toBe(1));

    expect(fetches.countOf(reportDashboardKeys.lists)).toBe(1);
    expect(fetches.countOf(reportAssetKeys.lists)).toBe(1);
    expect(api.countOf('GET', '/api/report/dashboards')).toBe(1);
    expect(api.countOf('GET', '/api/report/assets/catalog')).toBe(1);
    // published 模式取数随发布快照变化；其它看板的取数不受影响
    expect(isFresh(qc, DATA_KEY_7)).toBe(false);
    expect(isFresh(qc, DATA_KEY_8)).toBe(true);
    // 治理页同屏挂载的权限侧栏与转移列表与本次裁决无关
    expect(fetches.countOf(reportAclKeys.all)).toBe(0);
    expect(fetches.countOf(reportTransferKeys.all)).toBe(0);
    expect(isFresh(qc, reportAclKeys.list(ACL_PARAMS))).toBe(true);
    fetches.stop();
  });

  it('拒绝审批只改审批记录：看板列表与资产目录保持新鲜', async () => {
    const { qc, result } = mountGovernanceScreen();
    await settled(result);
    qc.setQueryData(DATA_KEY_7, {});

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.decideApproval.mutateAsync({ params: { id: 1 }, body: { decision: 'rejected' } });
    await waitFor(() => expect(fetches.countOf(reportApprovalKeys.all)).toBe(1));

    expect(fetches.countOf(reportDashboardKeys.lists)).toBe(0);
    expect(fetches.countOf(reportAssetKeys.lists)).toBe(0);
    expect(api.countOf('GET', '/api/report/dashboards')).toBe(0);
    expect(isFresh(qc, DATA_KEY_7)).toBe(true);
    fetches.stop();
  });
});

describe('useDecideReportTransfer', () => {
  it('接受数据集转移：转移列表与资产目录回源，数据集列表标脏，看板列表不动', async () => {
    const { qc, result } = mountGovernanceScreen();
    await settled(result);
    qc.setQueryData(reportDatasetKeys.list(PAGE), EMPTY_PAGE);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.decideTransfer.mutateAsync({ params: { id: 1 }, body: { decision: 'accepted' } });
    await waitFor(() => expect(fetches.countOf(reportTransferKeys.all)).toBe(1));

    expect(fetches.countOf(reportAssetKeys.lists)).toBe(1);
    expect(isFresh(qc, reportDatasetKeys.list(PAGE))).toBe(false);
    // 转移的是数据集，看板域不受牵连
    expect(fetches.countOf(reportDashboardKeys.lists)).toBe(0);
    expect(isFresh(qc, reportDashboardKeys.list(PAGE))).toBe(true);
    fetches.stop();
  });

  it('拒绝转移只改转移记录：资产目录与数据集列表保持新鲜', async () => {
    const { qc, result } = mountGovernanceScreen();
    await settled(result);
    qc.setQueryData(reportDatasetKeys.list(PAGE), EMPTY_PAGE);

    const fetches = observeFetches(qc);
    await result.current.decideTransfer.mutateAsync({ params: { id: 1 }, body: { decision: 'rejected' } });
    await waitFor(() => expect(fetches.countOf(reportTransferKeys.all)).toBe(1));

    expect(fetches.countOf(reportAssetKeys.lists)).toBe(0);
    expect(isFresh(qc, reportDatasetKeys.list(PAGE))).toBe(true);
    fetches.stop();
  });
});

describe('useGrantReportResourceAcl', () => {
  it('授权只回源该资源的权限列表（query 段部分匹配），其它资源的权限缓存保持新鲜', async () => {
    const { qc, result } = mountGovernanceScreen();
    await settled(result);
    const otherAclKey = reportAclKeys.list({ ...ACL_PARAMS, resourceId: 8 });
    qc.setQueryData(otherAclKey, []);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.grantAcl.mutateAsync({
      body: { resourceType: 'dashboard', resourceId: 7, subjectType: 'user', subjectId: 1, role: 'viewer' },
    });
    // `of()` 对 query 段做部分匹配（inheritFromFolder 不参与），harness 的前缀计数是逐段全等，用操作前缀 + 实际请求断言
    await waitFor(() => expect(fetches.countOf(reportAclKeys.all)).toBe(1));

    expect(api.countOf('GET', '/api/report/governance/acls')).toBe(1);
    expect(isFresh(qc, otherAclKey)).toBe(true);
    expect(fetches.countOf(reportDashboardKeys.lists)).toBe(0);
    fetches.stop();
  });
});

/**
 * report-datasources / report-subscriptions / report-fill 域缓存一致性契约
 *
 * 三处此前用资源根广播：数据源健康检查 / 启停 / 克隆打掉详情与下拉源，订阅推送打掉详情，
 * 填报记录流转打掉整个任务中心与整个数据集域（含数据库元数据与所有数据集的取数缓存）。
 * 收窄后按操作前缀精确触达，并把异步任务的真实副作用（任务中心多一条记录）补进来。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  getCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { asyncTaskKeys, useAsyncTaskList, useAsyncTaskTypes } from './async-tasks';
import {
  reportDatasourceKeys,
  useBatchReportDatasourceStatus,
  useCloneReportDatasource,
  useReportDatasourceDetail,
  useReportDatasourceList,
  useReportDatasourceLookup,
  useRunReportDatasourceHealthCheck,
} from './report-datasources';
import {
  reportSubscriptionKeys,
  useBatchReportSubscriptionEnabled,
  useReportSubscriptionHistory,
  useReportSubscriptionList,
  useRunReportSubscription,
} from './report-subscriptions';
import { reportFillKeys, useReportFillRecordMine, useSubmitReportFillRecord } from './report-fill';
import { reportDatasetKeys } from './report-datasets';
import { reportDesignerKeys } from './report-designer';

const PAGE = { page: 1, pageSize: 10 };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };
const LOOKUP_PARAMS = { status: 'enabled' as const, limit: 20 };
const TASK = { id: 99, status: 'pending' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/async-tasks', EMPTY_PAGE)
    .on('GET', '/api/async-tasks/types', [])
    .on('GET', '/api/report/datasources', EMPTY_PAGE)
    .on('GET', '/api/report/datasources/lookup', [])
    .on('GET', '/api/report/datasources/1', { id: 1, name: '主库' })
    .on('PUT', '/api/report/datasources/batch-status', null)
    .on('POST', '/api/report/datasources/1/clone', { id: 2, name: '主库副本' })
    .on('POST', '/api/report/datasources/health-check', TASK)
    .on('GET', '/api/report/subscriptions', EMPTY_PAGE)
    .on('GET', '/api/report/delivery-runs', EMPTY_PAGE)
    .on('POST', '/api/report/subscriptions/1/run', TASK)
    .on('PUT', '/api/report/subscriptions/batch-status', null)
    .on('GET', '/api/report/fill/records/mine', EMPTY_PAGE)
    .on('POST', '/api/report/fill/records/1/submit', { id: 1, generatedDatasetId: 5, syncStatus: 'pending' });
});

describe('report-datasources', () => {
  function mountDatasourcesPage() {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        list: useReportDatasourceList(PAGE),
        lookup: useReportDatasourceLookup(LOOKUP_PARAMS),
        detail: useReportDatasourceDetail(1),
        tasks: useAsyncTaskList(PAGE),
        taskTypes: useAsyncTaskTypes(),
        batchStatus: useBatchReportDatasourceStatus(),
        clone: useCloneReportDatasource(),
        healthCheck: useRunReportDatasourceHealthCheck(),
      }),
      { wrapper: createWrapper(qc) },
    );
    return { qc, ...hook };
  }

  async function settled(result: ReturnType<typeof mountDatasourcesPage>['result']) {
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.lookup.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.tasks.isSuccess).toBe(true);
      expect(result.current.taskTypes.isSuccess).toBe(true);
    });
  }

  it('批量启停回源列表、被操作数据源的详情与按状态过滤的下拉源', async () => {
    const { qc, result } = mountDatasourcesPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.batchStatus.mutateAsync({ body: { ids: [1], status: 'disabled' } });
    await waitFor(() => expect(fetches.countOf(reportDatasourceKeys.lists)).toBe(1));

    expect(fetches.countOf(reportDatasourceKeys.detail(1))).toBe(1);
    expect(fetches.countOf(reportDatasourceKeys.lookup)).toBe(1);
    expect(fetches.countOf(asyncTaskKeys.lists)).toBe(0);
    fetches.stop();
  });

  it('克隆只新增一条：列表与下拉源回源，源数据源详情保持新鲜', async () => {
    const { qc, result } = mountDatasourcesPage();
    await settled(result);

    const fetches = observeFetches(qc);
    await result.current.clone.mutateAsync({ params: { id: 1 }, body: {} });
    await waitFor(() => expect(fetches.countOf(reportDatasourceKeys.lists)).toBe(1));

    expect(fetches.countOf(reportDatasourceKeys.lookup)).toBe(1);
    expect(fetches.countOf(reportDatasourceKeys.detail(1))).toBe(0);
    expect(isFresh(qc, reportDatasourceKeys.detail(1))).toBe(true);
    fetches.stop();
  });

  it('健康检查是异步任务：任务中心列表回源、任务类型元数据不动，下拉源不含健康字段不动', async () => {
    const { qc, result } = mountDatasourcesPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.healthCheck.mutateAsync({ body: { ids: [1] } });
    await waitFor(() => expect(fetches.countOf(asyncTaskKeys.lists)).toBe(1));

    expect(fetches.countOf(reportDatasourceKeys.lists)).toBe(1);
    expect(fetches.countOf(reportDatasourceKeys.detail(1))).toBe(1);
    expect(fetches.countOf(asyncTaskKeys.types)).toBe(0);
    expect(fetches.countOf(reportDatasourceKeys.lookup)).toBe(0);
    expect(isFresh(qc, reportDatasourceKeys.lookup)).toBe(false); // 前缀：无输入的 lookup 键本身没有缓存条目
    expect(isFresh(qc, [...reportDatasourceKeys.lookup, { query: LOOKUP_PARAMS }])).toBe(true);
    fetches.stop();
  });
});

describe('report-subscriptions', () => {
  function mountSubscriptionsPage() {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        list: useReportSubscriptionList(PAGE),
        history1: useReportSubscriptionHistory(1),
        history2: useReportSubscriptionHistory(2),
        tasks: useAsyncTaskList(PAGE),
        run: useRunReportSubscription(),
        batch: useBatchReportSubscriptionEnabled(),
      }),
      { wrapper: createWrapper(qc) },
    );
    return { qc, ...hook };
  }

  async function settled(result: ReturnType<typeof mountSubscriptionsPage>['result']) {
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.history1.isSuccess).toBe(true);
      expect(result.current.history2.isSuccess).toBe(true);
      expect(result.current.tasks.isSuccess).toBe(true);
    });
  }

  it('立即推送：任务中心、订阅列表与该订阅的投递历史回源，其它订阅的历史保持新鲜', async () => {
    const { qc, result } = mountSubscriptionsPage();
    await settled(result);

    const fetches = observeFetches(qc);
    await result.current.run.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(fetches.countOf(reportSubscriptionKeys.history(1))).toBe(1));

    expect(fetches.countOf(asyncTaskKeys.lists)).toBe(1);
    expect(fetches.countOf(reportSubscriptionKeys.lists)).toBe(1);
    expect(fetches.countOf(reportSubscriptionKeys.history(2))).toBe(0);
    expect(isFresh(qc, reportSubscriptionKeys.history(2))).toBe(true);
    fetches.stop();
  });

  it('批量启停只回源订阅列表（与被操作订阅的详情），投递历史与任务中心不动', async () => {
    const { qc, result } = mountSubscriptionsPage();
    await settled(result);

    const fetches = observeFetches(qc);
    await result.current.batch.mutateAsync({ body: { ids: [1], enabled: false } });
    await waitFor(() => expect(fetches.countOf(reportSubscriptionKeys.lists)).toBe(1));

    expect(fetches.countOf(reportSubscriptionKeys.history())).toBe(0);
    expect(fetches.countOf(asyncTaskKeys.lists)).toBe(0);
    expect(isFresh(qc, reportSubscriptionKeys.history(1))).toBe(true);
    fetches.stop();
  });
});

describe('report-fill', () => {
  it('提交记录：详情回填、我的记录与任务中心回源，只有生成的那份数据集的取数缓存被标脏', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        mine: useReportFillRecordMine(PAGE),
        tasks: useAsyncTaskList(PAGE),
        taskTypes: useAsyncTaskTypes(),
        submit: useSubmitReportFillRecord(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.mine.isSuccess).toBe(true);
      expect(result.current.tasks.isSuccess).toBe(true);
      expect(result.current.taskTypes.isSuccess).toBe(true);
    });
    const generatedData = reportDesignerKeys.datasetData(5, {}, 500);
    const otherData = reportDesignerKeys.datasetData(6, {}, 500);
    qc.setQueryData(generatedData, { rows: [] });
    qc.setQueryData(otherData, { rows: [] });
    qc.setQueryData(reportDatasetKeys.metaTables, []);

    const fetches = observeFetches(qc);
    await result.current.submit.mutateAsync({ params: { id: 1 }, body: { expectedRevision: 1 } });
    await waitFor(() => expect(fetches.countOf(reportFillKeys.recordMineLists)).toBe(1));

    expect(fetches.countOf(asyncTaskKeys.lists)).toBe(1);
    expect(fetches.countOf(asyncTaskKeys.types)).toBe(0);
    expect(getCacheEntry<{ id: number }>(qc, reportFillKeys.recordDetail(1))?.id).toBe(1);
    // 生成的数据集 5 的取数缓存标脏；数据集 6 与数据库元数据不受影响
    expect(isFresh(qc, generatedData)).toBe(false);
    expect(isFresh(qc, otherData)).toBe(true);
    expect(isFresh(qc, reportDatasetKeys.metaTables)).toBe(true);
    fetches.stop();
  });
});

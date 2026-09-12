/**
 * report-dq 域缓存一致性契约
 *
 * 质量页一屏挂着规则、运行历史、异常与评分。收窄前任何写操作都整域失效，
 * 启停一条规则会把运行历史 / 异常 / 评分全部打回源；现在规则写操作只碰规则，
 * 异常状态流转只碰异常，只有异步执行才把 worker 会回写的运行 / 异常 / 评分标脏。
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
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  reportDqKeys,
  useCurrentReportDqScore,
  useReportDqAnomalyList,
  useReportDqRuleList,
  useReportDqRunList,
  useRunReportDqRule,
  useToggleReportDqRule,
  useUpdateReportDqAnomalyStatus,
} from './report-dq';

const PAGE = { page: 1, pageSize: 10 };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };
const RULE = { id: 1, datasetId: 3, enabled: true };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/report/dq/rules', EMPTY_PAGE)
    .on('GET', '/api/report/dq/runs', EMPTY_PAGE)
    .on('GET', '/api/report/dq/anomalies', EMPTY_PAGE)
    .on('GET', '/api/report/dq/datasets/3/score', null)
    .on('GET', '/api/async-tasks', EMPTY_PAGE)
    .on('POST', '/api/report/dq/rules/1/toggle', { ...RULE, enabled: false })
    .on('POST', '/api/report/dq/rules/1/run', { id: 99, status: 'pending' })
    .on('POST', '/api/report/dq/anomalies/9/status', { id: 9, datasetId: 3, status: 'resolved' });
});

function mountQualityPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      rules: useReportDqRuleList(PAGE),
      runs: useReportDqRunList(PAGE),
      anomalies: useReportDqAnomalyList(PAGE),
      score: useCurrentReportDqScore(3),
      toggle: useToggleReportDqRule(),
      run: useRunReportDqRule(),
      anomaly: useUpdateReportDqAnomalyStatus(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, ...hook };
}

async function settled(result: ReturnType<typeof mountQualityPage>['result']) {
  await waitFor(() => {
    expect(result.current.rules.isSuccess).toBe(true);
    expect(result.current.runs.isSuccess).toBe(true);
    expect(result.current.anomalies.isSuccess).toBe(true);
    expect(result.current.score.isSuccess).toBe(true);
  });
}

describe('useToggleReportDqRule', () => {
  it('启停只回源规则列表，运行历史 / 异常 / 评分保持新鲜', async () => {
    const { qc, result } = mountQualityPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.toggle.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(fetches.countOf(reportDqKeys.lists)).toBe(1));

    expect(fetches.countOf(reportDqKeys.runLists)).toBe(0);
    expect(fetches.countOf(reportDqKeys.anomalyLists)).toBe(0);
    expect(fetches.countOf(reportDqKeys.currentScores)).toBe(0);
    expect(isFresh(qc, reportDqKeys.runs(PAGE))).toBe(true);
    expect(isFresh(qc, reportDqKeys.anomalies(PAGE))).toBe(true);
    expect(isFresh(qc, reportDqKeys.currentScore(3))).toBe(true);
    expect(api.countOf('GET')).toBe(1);
    fetches.stop();
  });
});

describe('useUpdateReportDqAnomalyStatus', () => {
  it('确认 / 解决异常只回源异常列表，规则与运行历史保持新鲜', async () => {
    const { qc, result } = mountQualityPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.anomaly.mutateAsync({ params: { id: 9 }, body: { status: 'resolved' } });
    await waitFor(() => expect(fetches.countOf(reportDqKeys.anomalyLists)).toBe(1));

    expect(fetches.countOf(reportDqKeys.lists)).toBe(0);
    expect(fetches.countOf(reportDqKeys.runLists)).toBe(0);
    expect(isFresh(qc, reportDqKeys.list(PAGE))).toBe(true);
    expect(isFresh(qc, reportDqKeys.currentScore(3))).toBe(true);
    fetches.stop();
  });
});

describe('useRunReportDqRule', () => {
  it('异步执行把 worker 会回写的运行 / 异常 / 评分与规则一并标脏回源', async () => {
    const { qc, result } = mountQualityPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.run.mutateAsync({ params: { id: 1 }, body: { sampleLimit: 20 } });
    await waitFor(() => expect(fetches.countOf(reportDqKeys.runLists)).toBe(1));

    expect(fetches.countOf(reportDqKeys.lists)).toBe(1);
    expect(fetches.countOf(reportDqKeys.anomalyLists)).toBe(1);
    expect(fetches.countOf(reportDqKeys.currentScores)).toBe(1);
    expect(api.countOf('GET', '/api/report/dq/datasets/3/score')).toBe(1);
    fetches.stop();
  });
});

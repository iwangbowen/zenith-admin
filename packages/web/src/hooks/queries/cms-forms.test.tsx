/**
 * cms-forms 域缓存一致性契约
 *
 * 收敛前删除提交数据 `invalidateQueries(cmsFormKeys.all)`，把其它表单正在查看的提交列表也打回源。
 * 收敛后只失效该表单的提交分页（`submissionsOf(formId)` 前缀）与表单列表（submissionCount 列）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import { cmsFormKeys, useCmsFormList, useCmsFormSubmissions, useDeleteCmsFormSubmissions } from './cms-forms';

const SITE_ID = 1;
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/cms/forms', { ...EMPTY_PAGE, list: [{ id: 1, submissionCount: 2 }, { id: 2, submissionCount: 5 }], total: 2 })
    .on('GET', '/api/cms/forms/1/submissions', EMPTY_PAGE)
    .on('GET', '/api/cms/forms/2/submissions', EMPTY_PAGE)
    .on('POST', '/api/cms/forms/1/submissions/delete', null);
});

describe('useDeleteCmsFormSubmissions', () => {
  it('refetches the form list and only the affected form submissions', async () => {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        forms: useCmsFormList({ page: 1, pageSize: 10, siteId: SITE_ID }),
        first: useCmsFormSubmissions(1, 1, 10),
        second: useCmsFormSubmissions(2, 1, 10),
        remove: useDeleteCmsFormSubmissions(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(hook.result.current.forms.isSuccess).toBe(true);
      expect(hook.result.current.first.isSuccess).toBe(true);
      expect(hook.result.current.second.isSuccess).toBe(true);
    });

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.remove.mutateAsync({ params: { id: 1 }, body: { ids: [100] } });
    await waitFor(() => {
      expect(hook.result.current.forms.isFetching).toBe(false);
      expect(hook.result.current.first.isFetching).toBe(false);
    });

    expect(fetches.countOf(cmsFormKeys.lists)).toBe(1);
    // `submissionsOf(1)` 靠 partialMatchKey 前缀命中；harness 的 countOf 按段精确比较，故用完整 key 断言
    expect(fetches.countOf(cmsFormKeys.submissions(1, 1, 10))).toBe(1);
    // 收敛前：另一张表单的提交列表也会被 `.all` 打回源
    expect(fetches.countOf(cmsFormKeys.submissions(2, 1, 10))).toBe(0);
    expect(isFresh(qc, cmsFormKeys.submissions(2, 1, 10))).toBe(true);
    expect(api.countOf('GET', '/api/cms/forms/2/submissions')).toBe(0);

    fetches.stop();
  });
});

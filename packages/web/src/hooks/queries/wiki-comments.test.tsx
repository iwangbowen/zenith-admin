/**
 * wiki-comments 域缓存一致性契约
 *
 * 删除类接口只回传提示文案、路径里没有 docId：docId 作为失效上下文随变量带入，
 * 只交给 invalidate、不参与请求；其它文档的评论树不被牵连。
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

import { useDeleteMyWikiComment, useRemoveWikiComment, useWikiCommentList, useWikiDocComments, wikiCommentKeys } from './wiki-comments';
import { useWikiDocDetail, wikiDocKeys } from './wiki-docs';

const PAGE = { page: 1, pageSize: 10 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/wiki/comments/doc/1', [])
    .on('GET', '/api/wiki/comments/doc/2', [])
    .on('GET', '/api/wiki/comments', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/wiki/docs/1', { id: 1, spaceId: 1, commentCount: 0 })
    .on('DELETE', '/api/wiki/comments/mine/5', null)
    .on('DELETE', '/api/wiki/comments/5', null);
});

function mount() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      tree1: useWikiDocComments(1),
      tree2: useWikiDocComments(2),
      list: useWikiCommentList(PAGE),
      detail: useWikiDocDetail(1),
      deleteMine: useDeleteMyWikiComment(),
      remove: useRemoveWikiComment(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, ...hook };
}

async function settled(result: ReturnType<typeof mount>['result']) {
  await waitFor(() => {
    expect(result.current.tree1.isSuccess).toBe(true);
    expect(result.current.tree2.isSuccess).toBe(true);
    expect(result.current.list.isSuccess).toBe(true);
    expect(result.current.detail.isSuccess).toBe(true);
  });
}

describe('useDeleteMyWikiComment', () => {
  it('删除自己的评论：只回源所属文档的评论树、详情与管理列表，docId 不进入请求', async () => {
    const { qc, result } = mount();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.deleteMine.mutateAsync({ params: { id: 5 }, docId: 1 });
    await waitFor(() => expect(fetches.countOf(wikiCommentKeys.doc(1))).toBe(1));

    const deleteCall = api.calls.find((call) => call.method === 'DELETE');
    expect(deleteCall?.url).toBe('/api/wiki/comments/mine/5');
    expect(deleteCall?.body).toBeUndefined();
    expect(fetches.countOf(wikiDocKeys.detail(1))).toBe(1);
    expect(fetches.countOf(wikiCommentKeys.lists)).toBe(1);
    // 另一篇文档的评论树与本次删除无关
    expect(fetches.countOf(wikiCommentKeys.doc(2))).toBe(0);
    expect(isFresh(qc, wikiCommentKeys.doc(2))).toBe(true);
    fetches.stop();
  });
});

describe('useRemoveWikiComment', () => {
  it('管理端删除同样按变量携带的 docId 精确失效', async () => {
    const { qc, result } = mount();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.remove.mutateAsync({ params: { id: 5 }, docId: 1 });
    await waitFor(() => expect(fetches.countOf(wikiCommentKeys.doc(1))).toBe(1));

    expect(api.calls.find((call) => call.method === 'DELETE')?.url).toBe('/api/wiki/comments/5');
    expect(fetches.countOf(wikiDocKeys.detail(1))).toBe(1);
    expect(isFresh(qc, wikiCommentKeys.doc(2))).toBe(true);
    fetches.stop();
  });
});

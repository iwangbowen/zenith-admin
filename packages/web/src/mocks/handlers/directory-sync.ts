import { directorySyncContract, directorySyncSourceContract, type DirectorySyncSource } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';
import { createImmediateMockTask } from './async-tasks';
import { filterByKeyword } from '@/mocks/utils/filter';
import {
  mockDirectorySyncSources, getNextDirectorySyncSourceId,
  mockDirectorySyncRuns, mockDirectorySyncRunItems, mockDirectorySyncConflicts,
  simulateDirectorySyncRun,
} from '../data/directory-sync';

function findSource(id: number) {
  return mockDirectorySyncSources.find((s) => s.id === id);
}

export const directorySyncHandlers = [
  // ─── 同步源 ─────────────────────────────────────────────────────────────
  mock(directorySyncSourceContract.list, ({ query, ok, paginate }) => {
    const { keyword, type, status } = query;
    let list = [...mockDirectorySyncSources];
    if (keyword) list = filterByKeyword(list, keyword, [(s) => s.name, (s) => s.remark]);
    if (type) list = list.filter((s) => s.type === type);
    if (status) list = list.filter((s) => s.status === status);
    return ok(paginate(list));
  }),

  mock(directorySyncSourceContract.create, ({ body, ok }) => {
    if (mockDirectorySyncSources.some((s) => s.name === body.name)) {
      return badRequest('同名同步源已存在', { status: 400 });
    }
    const now = mockDateTime();
    const newId = getNextDirectorySyncSourceId();
    const { contactSecret, callbackToken, callbackAesKey, ...rest } = body;
    const source: DirectorySyncSource = {
      ...rest,
      id: newId,
      tenantId: body.tenantId ?? null,
      identityProviderId: body.identityProviderId ?? null,
      identityProviderName: body.identityProviderId ? '企业 AD' : null,
      oauthProvider: body.oauthProvider ?? null,
      cronExpression: body.cronExpression ?? null,
      contactSecretSet: Boolean(contactSecret),
      callbackTokenSet: Boolean(callbackToken),
      callbackAesKeySet: Boolean(callbackAesKey),
      callbackUrlKey: `demo-callback-key-${newId}`,
      callbackLastEventAt: null,
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockDirectorySyncSources.push(source);
    return ok(source, '创建成功');
  }),

  mock(directorySyncSourceContract.detail, ({ params, ok }) => {
    const source = findSource(params.id);
    if (!source) return notFound('同步源不存在', { status: 404 });
    return ok(source);
  }),

  mock(directorySyncSourceContract.update, ({ params, body, ok }) => {
    const source = findSource(params.id);
    if (!source) return notFound('同步源不存在', { status: 404 });
    const { contactSecret, callbackToken, callbackAesKey, ...rest } = body;
    Object.assign(source, { ...rest, updatedAt: mockDateTime() });
    if (contactSecret) source.contactSecretSet = true;
    if (callbackToken) source.callbackTokenSet = true;
    if (callbackAesKey) source.callbackAesKeySet = true;
    return ok(source, '更新成功');
  }),

  mock(directorySyncSourceContract.remove, ({ params, ok }) => {
    const idx = mockDirectorySyncSources.findIndex((s) => s.id === params.id);
    if (idx === -1) return notFound('同步源不存在', { status: 404 });
    mockDirectorySyncSources.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(directorySyncSourceContract.test, ({ params, ok }) => {
    const source = findSource(params.id);
    if (!source) return notFound('同步源不存在', { status: 404 });
    return ok({
      ok: true,
      message: '连接成功，抽样 3 个目录用户',
      sampleUsers: [
        { externalId: 'demo-1', username: 'wangxm', nickname: '王小明' },
        { externalId: 'demo-2', username: 'chenj', nickname: '陈静' },
        { externalId: 'demo-3', username: 'zhoul', nickname: '周磊' },
      ],
    });
  }),

  mock(directorySyncSourceContract.preview, ({ params, ok }) => {
    const source = findSource(params.id);
    if (!source) return notFound('同步源不存在', { status: 404 });
    simulateDirectorySyncRun(source, { dryRun: true, triggerType: 'preview' });
    const task = createImmediateMockTask({
      taskType: 'directory-sync-run',
      title: `通讯录差异预览（${source.name}）`,
      module: '通讯录同步',
      payload: { sourceId: source.id, dryRun: true },
      maxAttempts: 1,
    });
    return ok(task, '预览任务已提交，请在同步记录中查看差异');
  }),

  mock(directorySyncSourceContract.run, ({ params, ok }) => {
    const source = findSource(params.id);
    if (!source) return notFound('同步源不存在', { status: 404 });
    simulateDirectorySyncRun(source, { dryRun: false, triggerType: 'manual' });
    const task = createImmediateMockTask({
      taskType: 'directory-sync-run',
      title: `通讯录同步（${source.name}）`,
      module: '通讯录同步',
      payload: { sourceId: source.id, dryRun: false },
      maxAttempts: 1,
    });
    return ok(task, '同步任务已提交');
  }),

  // ─── 同步记录 ───────────────────────────────────────────────────────────
  mock(directorySyncContract.listRuns, ({ query, ok, paginate }) => {
    const { sourceId, status } = query;
    let list = [...mockDirectorySyncRuns];
    if (sourceId) list = list.filter((r) => r.sourceId === sourceId);
    if (status) list = list.filter((r) => r.status === status);
    return ok(paginate(list));
  }),

  mock(directorySyncContract.runDetail, ({ params, ok }) => {
    const run = mockDirectorySyncRuns.find((r) => r.id === params.id);
    if (!run) return notFound('同步记录不存在', { status: 404 });
    return ok(run);
  }),

  mock(directorySyncContract.listRunItems, ({ params, query, ok, paginate }) => {
    const { action, entityType } = query;
    let list = mockDirectorySyncRunItems.filter((i) => i.runId === params.id);
    if (action) list = list.filter((i) => i.action === action);
    if (entityType) list = list.filter((i) => i.entityType === entityType);
    return ok(paginate(list));
  }),

  mock(directorySyncContract.retryRun, ({ params, ok }) => {
    const run = mockDirectorySyncRuns.find((r) => r.id === params.id);
    if (!run) return notFound('同步记录不存在', { status: 404 });
    const source = mockDirectorySyncSources.find((s) => s.id === run.sourceId);
    if (!source) return badRequest('同步源已删除', { status: 400 });
    simulateDirectorySyncRun(source, { dryRun: false, triggerType: 'manual' });
    const task = createImmediateMockTask({
      taskType: 'directory-sync-run',
      title: `通讯录同步（${source.name}）`,
      module: '通讯录同步',
      payload: { sourceId: source.id, dryRun: false },
      maxAttempts: 1,
    });
    return ok(task, '重试任务已提交');
  }),

  // ─── 冲突处理 ───────────────────────────────────────────────────────────
  mock(directorySyncContract.listConflicts, ({ query, ok, paginate }) => {
    const { keyword, sourceId, status } = query;
    let list = [...mockDirectorySyncConflicts];
    if (keyword) list = filterByKeyword(list, keyword, [(c) => c.name, (c) => c.externalId]);
    if (sourceId) list = list.filter((c) => c.sourceId === sourceId);
    if (status) list = list.filter((c) => c.status === status);
    return ok(paginate(list));
  }),

  mock(directorySyncContract.ignoreConflicts, ({ body, ok }) => {
    if (body.ids.length === 0) return badRequest('请选择要忽略的冲突', { status: 400 });
    const selected = new Set(body.ids);
    let count = 0;
    const now = mockDateTime();
    for (const conflict of mockDirectorySyncConflicts) {
      if (selected.has(conflict.id) && conflict.status === 'pending') {
        conflict.status = 'ignored';
        conflict.resolution = 'local';
        conflict.resolvedBy = 1;
        conflict.resolvedByNickname = '管理员';
        conflict.resolvedAt = now;
        conflict.updatedAt = now;
        count += 1;
      }
    }
    return ok(null, `已忽略 ${count} 条冲突`);
  }),

  mock(directorySyncContract.resolveConflict, ({ params, body, ok }) => {
    const conflict = mockDirectorySyncConflicts.find((c) => c.id === params.id);
    if (!conflict) return notFound('冲突记录不存在', { status: 404 });
    if (conflict.status !== 'pending') return badRequest('该冲突已处理', { status: 400 });
    if (conflict.conflictType === 'multi_match' && body.resolution === 'source' && !body.targetUserId) {
      return badRequest('请选择要绑定的本地账号', { status: 400 });
    }
    const now = mockDateTime();
    conflict.status = 'resolved';
    conflict.resolution = body.resolution;
    conflict.resolvedBy = 1;
    conflict.resolvedByNickname = '管理员';
    conflict.resolvedAt = now;
    conflict.updatedAt = now;
    return ok(conflict, '裁决成功');
  }),
];

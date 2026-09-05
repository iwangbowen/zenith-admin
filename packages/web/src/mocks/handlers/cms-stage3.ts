import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mock } from '@/mocks/utils/contract';
import { cmsPublishingContract } from '@zenith/shared/cms';
import type { CmsPublishTargetType } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import {
  mockCmsPublishArtifacts,
  mockCmsPublishingTasks,
} from '../data/cms-stage3';
import { mockCmsSites } from '../data/cms';
import { mockDateTime } from '../utils/date';
import { createProgressingMockTask } from './async-tasks';

function toPublishingTask(task: AsyncTask, targetType: CmsPublishTargetType, siteId: number) {
  const siteName = mockCmsSites.find((site) => site.id === siteId)?.name ?? null;
  return Object.assign(task, {
    siteId,
    siteName,
    siteIds: [siteId],
    siteNames: siteName ? [siteName] : [],
    targetType,
    artifactCount: mockCmsPublishArtifacts.filter((artifact) => artifact.taskId === task.id).length,
    failedArtifactCount: mockCmsPublishArtifacts.filter((artifact) => artifact.taskId === task.id && artifact.status === 'failed').length,
  });
}

export const cmsStage3Handlers = [
  mock(cmsPublishingContract.artifacts, ({ query, ok, paginate }) => {
    let rows = [...mockCmsPublishArtifacts];
    const { siteId, targetType, status, keyword, startTime, endTime } = query;
    if (siteId) rows = rows.filter((item) => item.siteId === siteId);
    if (targetType) rows = rows.filter((item) => item.targetType === targetType);
    if (status) rows = rows.filter((item) => item.status === status);
    if (keyword) rows = rows.filter((item) => item.path.includes(keyword) || item.url?.includes(keyword));
    if (startTime) rows = rows.filter((item) => (item.generatedAt ?? item.updatedAt) >= startTime);
    if (endTime) rows = rows.filter((item) => (item.generatedAt ?? item.updatedAt) <= endTime);
    return ok(paginate(rows), 'success');
  }),

  mock(cmsPublishingContract.submit, ({ body, ok }) => {
    const task = createProgressingMockTask({
      taskType: 'cms-publish-build',
      title: `CMS ${body.targetType} 发布`,
      payload: body,
      totalItems: body.targetType === 'site' ? 12 : Math.max(1, body.contentIds?.length ?? 4),
      itemDelayMs: 250,
    });
    mockCmsPublishingTasks.unshift(toPublishingTask(task, body.targetType, body.siteId));
    return ok(task, '发布任务已提交');
  }),

  mock(cmsPublishingContract.batchAction, ({ body, ok }) => {
    let affected = 0;
    for (const id of body.ids) {
      const task = mockCmsPublishingTasks.find((item) => item.id === id);
      if (!task) continue;
      if (body.action === 'cancel' && ['pending', 'running'].includes(task.status)) task.status = 'cancelled';
      else if (body.action !== 'cancel' && ['success', 'failed', 'cancelled'].includes(task.status)) {
        task.status = 'pending';
        if (body.action === 'restart' || body.action === 'rebuild') {
          mockCmsPublishArtifacts.splice(0, mockCmsPublishArtifacts.length, ...mockCmsPublishArtifacts.filter((item) => item.taskId !== id));
        }
      }
      else continue;
      affected++;
    }
    return ok({ affected, errors: [] }, 'success');
  }),

  mock(cmsPublishingContract.detail, ({ params, ok }) => {
    const task = mockCmsPublishingTasks.find((item) => item.id === params.id);
    if (!task) return notFound('CMS 发布任务不存在', { status: 404 });
    const artifacts = mockCmsPublishArtifacts.filter((item) => item.taskId === task.id);
    return ok({
      task,
      items: artifacts.map((item, index) => ({
        id: index + 1,
        taskId: task.id,
        itemKey: item.path,
        label: item.path,
        status: item.status === 'failed' ? 'failed' as const : 'success' as const,
        message: item.error,
        data: { path: item.path },
        attempt: task.attempts || 1,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      artifacts,
    }, 'success');
  }),

  mock(cmsPublishingContract.action, ({ params, ok }) => {
    const task = mockCmsPublishingTasks.find((item) => item.id === params.id);
    if (!task) return notFound('CMS 发布任务不存在', { status: 404 });
    const { action } = params;
    if (action === 'cancel' && ['pending', 'running'].includes(task.status)) task.status = 'cancelled';
    else if (action === 'resume' && ['failed', 'cancelled'].includes(task.status)) task.status = 'pending';
    else if ((action === 'restart' || action === 'rebuild') && ['success', 'failed', 'cancelled'].includes(task.status)) {
      task.status = 'pending';
      mockCmsPublishArtifacts.splice(0, mockCmsPublishArtifacts.length, ...mockCmsPublishArtifacts.filter((item) => item.taskId !== task.id));
    } else return badRequest('当前任务状态不支持该操作', { status: 400 });
    task.updatedAt = mockDateTime();
    return ok(task, 'success');
  }),

  mock(cmsPublishingContract.list, ({ query, ok, paginate }) => {
    let rows = [...mockCmsPublishingTasks];
    const { siteId, targetType, status, keyword, taskType, startTime, endTime } = query;
    const createdBy = query.createdBy?.trim().toLowerCase();
    if (siteId) rows = rows.filter((item) => item.siteIds.includes(siteId));
    if (targetType) rows = rows.filter((item) => item.targetType === targetType);
    if (taskType) rows = rows.filter((item) => item.taskType === taskType);
    if (createdBy) rows = rows.filter((item) => (item.createdByName ?? '').toLowerCase().includes(createdBy));
    if (status === 'active') rows = rows.filter((item) => ['pending', 'running'].includes(item.status));
    else if (status === 'terminal') rows = rows.filter((item) => ['success', 'failed', 'cancelled'].includes(item.status));
    else if (status) rows = rows.filter((item) => item.status === status);
    if (keyword) rows = rows.filter((item) => item.title.includes(keyword) || item.taskType.includes(keyword));
    if (startTime) rows = rows.filter((item) => item.createdAt >= startTime);
    if (endTime) rows = rows.filter((item) => item.createdAt <= endTime);
    rows.forEach((task) => {
      task.artifactCount = mockCmsPublishArtifacts.filter((item) => item.taskId === task.id).length;
      task.failedArtifactCount = mockCmsPublishArtifacts.filter((item) => item.taskId === task.id && item.status === 'failed').length;
    });
    return ok(paginate(rows), 'success');
  }),
];

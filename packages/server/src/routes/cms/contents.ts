import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsContentSchema, lockCmsContentSchema, updateCmsContentSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, BatchIdsBody, okBody,
} from '../../lib/openapi-schemas';
import { CmsContentDTO, CmsContentLockDTO } from '../../lib/openapi-dtos';
import {
  listCmsContents, getCmsContent, createCmsContent, updateCmsContent,
  submitCmsContent, publishCmsContent, rejectCmsContent, offlineCmsContent,
  recycleCmsContents, restoreCmsContents, purgeCmsContents, restoreCmsContentToVersion,
  batchMoveCmsContents, batchSetCmsContentFlags, batchAddCmsContentTags,
  duplicateCmsContent, distributeCmsContents, archiveCmsContents, unarchiveCmsContents,
  checkCmsContentTitle, ensureCmsContentTargetAccess,
} from '../../services/cms/cms-contents.service';
import { listContentVersions, diffContentVersion } from '../../services/cms/cms-versions.service';
import { listContentOpLogs } from '../../services/cms/cms-content-op-logs.service';
import { checkCmsText } from '../../services/cms/cms-word-check.service';
import { acquireContentEditLock, releaseContentEditLock } from '../../services/cms/cms-edit-lock.service';
import { createContentPreviewLink } from '../../services/cms/cms-preview.service';
import { CmsContentVersionDTO, CmsContentVersionDiffDTO, CmsEditLockDTO, CmsPreviewLinkDTO, AsyncTaskDTO, CmsContentOpLogDTO, CmsTextCheckResultDTO } from '../../lib/openapi-dtos';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { lockCmsContent, unlockCmsContent } from '../../services/cms/cms-content-lock.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-内容管理'], summary: '内容分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        channelId: z.coerce.number().int().positive().optional(),
        status: z.enum(['draft', 'pending', 'published', 'offline', 'rejected']).optional(),
        contentType: z.enum(['article', 'album', 'media', 'link']).optional(),
        keyword: z.string().optional(),
        isTop: boolParam,
        isRecommend: boolParam,
        isHot: boolParam,
        deleted: boolParam,
        archived: boolParam,
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsContentDTO, '内容列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsContents(c.req.valid('query'))), 200),
});

const checkTitleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/check-title',
    tags: ['CMS-内容管理'], summary: '同站标题查重（编辑辅助，不阻断保存）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: {
      query: z.object({
        siteId: z.coerce.number().int().positive(),
        title: z.string().min(1).max(255),
        excludeId: z.coerce.number().int().positive().optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({
        duplicate: z.boolean(),
        matches: z.array(z.object({ id: z.number().int(), title: z.string(), status: z.string() })),
      }), '查重结果'),
    },
  }),
  handler: async (c) => {
    const { siteId, title, excludeId } = c.req.valid('query');
    return c.json(okBody(await checkCmsContentTitle(siteId, title, excludeId)), 200);
  },
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-内容管理'], summary: '内容详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsContentDTO, '内容详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsContent(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-内容管理'], summary: '创建内容（默认草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: '创建 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsContentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsContent(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-内容管理'], summary: '更新内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: '更新 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsContentSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsContentDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await updateCmsContent(id, c.req.valid('json'));
    return c.json(okBody(row, '更新成功'), 200);
  },
});

// ─── 状态流转 ─────────────────────────────────────────────────────────────────
const submitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/submit',
    tags: ['CMS-内容管理'], summary: '提交审核',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: '提交 CMS 内容审核', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '已提交审核') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    return c.json(okBody(await submitCmsContent(id), '已提交审核'), 200);
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish',
    tags: ['CMS-内容管理'], summary: '发布（直接发布或审核通过）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:publish', audit: { description: '发布 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '发布成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    const row = await publishCmsContent(id);
    return c.json(okBody(row, '发布成功'), 200);
  },
});

const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/reject',
    tags: ['CMS-内容管理'], summary: '驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:audit', audit: { description: '驳回 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ reason: z.string().min(1, '驳回原因不能为空').max(500) })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '已驳回') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    return c.json(okBody(await rejectCmsContent(id, reason), '已驳回'), 200);
  },
});

const offlineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/offline',
    tags: ['CMS-内容管理'], summary: '下线',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:publish', audit: { description: '下线 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '已下线') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    const row = await offlineCmsContent(id);
    return c.json(okBody(row, '已下线'), 200);
  },
});

// ─── 回收站 ───────────────────────────────────────────────────────────────────
const recycleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/recycle',
    tags: ['CMS-内容管理'], summary: '移入回收站（批量）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容移入回收站', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已移入回收站') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await recycleCmsContents(ids);
    return c.json(okBody(null, `已移入回收站 ${count} 条`), 200);
  },
});

const restoreRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/restore',
    tags: ['CMS-内容管理'], summary: '从回收站恢复（批量，恢复为草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容从回收站恢复', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已恢复') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await restoreCmsContents(ids);
    return c.json(okBody(null, `已恢复 ${count} 条`), 200);
  },
});

const purgeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/purge',
    tags: ['CMS-内容管理'], summary: '彻底删除（批量，仅限回收站内容）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容彻底删除', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await purgeCmsContents(ids);
    return c.json(okBody(null, `已彻底删除 ${count} 条`), 200);
  },
});

// ─── 版本历史 ─────────────────────────────────────────────────────────────────
const versionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/versions',
    tags: ['CMS-内容管理'], summary: '内容版本历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsContentVersionDTO), '版本列表') },
  }),
  handler: async (c) => c.json(okBody(await listContentVersions(c.req.valid('param').id)), 200),
});

const restoreVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/versions/{versionId}/restore',
    tags: ['CMS-内容管理'], summary: '回滚到指定版本（回滚前自动留档当前状态）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容版本回滚', module: 'CMS内容管理' } })] as const,
    request: {
      params: IdParam.extend({
        versionId: z.coerce.number().int().positive().openapi({ param: { name: 'versionId', in: 'path' } }),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '回滚成功') },
  }),
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await restoreCmsContentToVersion(id, versionId);
    return c.json(okBody(row, '回滚成功'), 200);
  },
});

const versionDiffRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/versions/{versionId}/diff',
    tags: ['CMS-内容管理'], summary: '版本差异对比（历史版本 vs 当前内容，仅返回变更字段）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: {
      params: IdParam.extend({
        versionId: z.coerce.number().int().positive().openapi({ param: { name: 'versionId', in: 'path' } }),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsContentVersionDiffDTO), '差异字段列表') },
  }),
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    return c.json(okBody(await diffContentVersion(id, versionId)), 200);
  },
});

// ─── 编辑锁 / 草稿预览 ─────────────────────────────────────────────────────────
const editLockAcquireRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/edit-lock',
    tags: ['CMS-内容管理'], summary: '抢占/续期内容编辑锁（软锁，防多人同编相互覆盖）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsEditLockDTO, '锁状态') },
  }),
  handler: async (c) => c.json(okBody(await acquireContentEditLock(c.req.valid('param').id)), 200),
});

const editLockReleaseRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/edit-lock',
    tags: ['CMS-内容管理'], summary: '释放内容编辑锁（仅持有人生效）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已释放') },
  }),
  handler: async (c) => {
    await releaseContentEditLock(c.req.valid('param').id);
    return c.json(okBody(null, '已释放'), 200);
  },
});

const previewLinkRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/preview-link',
    tags: ['CMS-内容管理'], summary: '生成草稿预览链接（签名临时链接，默认 2 小时有效）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsPreviewLinkDTO, '预览链接') },
  }),
  handler: async (c) => c.json(okBody(await createContentPreviewLink(c.req.valid('param').id)), 200),
});

// ─── P3：批量操作 / 复制 / 站群分发 ─────────────────────────────────────────────
const batchMoveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-move',
    tags: ['CMS-内容管理'], summary: '批量移动栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容批量移动', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(z.object({ ids: z.array(z.number().int()).min(1), channelId: z.number().int().positive() })), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('移动成功') },
  }),
  handler: async (c) => {
    const { ids, channelId } = c.req.valid('json');
    const count = await batchMoveCmsContents(ids, channelId);
    return c.json(okBody(null, `已移动 ${count} 条内容`), 200);
  },
});

const batchFlagsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-flags',
    tags: ['CMS-内容管理'], summary: '批量设置属性（置顶/推荐/热门/原创）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容批量设置属性', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          ids: z.array(z.number().int()).min(1),
          isTop: z.boolean().optional(),
          isRecommend: z.boolean().optional(),
          isHot: z.boolean().optional(),
          isOriginal: z.boolean().optional(),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('设置成功') },
  }),
  handler: async (c) => {
    const { ids, ...flags } = c.req.valid('json');
    const count = await batchSetCmsContentFlags(ids, flags);
    return c.json(okBody(null, `已更新 ${count} 条内容`), 200);
  },
});

const batchTagRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-tag',
    tags: ['CMS-内容管理'], summary: '批量追加标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容批量打标', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(z.object({ ids: z.array(z.number().int()).min(1), tagIds: z.array(z.number().int()).min(1) })), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('打标成功') },
  }),
  handler: async (c) => {
    const { ids, tagIds } = c.req.valid('json');
    const count = await batchAddCmsContentTags(ids, tagIds);
    return c.json(okBody(null, `已为 ${count} 条内容追加标签`), 200);
  },
});

const duplicateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/duplicate',
    tags: ['CMS-内容管理'], summary: '复制为草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: 'CMS 内容复制', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '复制成功') },
  }),
  handler: async (c) => c.json(okBody(await duplicateCmsContent(c.req.valid('param').id), '复制成功'), 200),
});

const distributeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/distribute',
    tags: ['CMS-内容管理'], summary: '站群分发（copy=独立复制 / mapping=映射，正文共享来源）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:distribution:run', audit: { description: 'CMS 内容站群分发', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          ids: z.array(z.number().int()).min(1),
          targetSiteId: z.number().int().positive(),
          targetChannelId: z.number().int().positive(),
          mode: z.enum(['copy', 'mapping']).default('copy'),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('分发成功') },
  }),
  handler: async (c) => {
    const { ids, targetSiteId, targetChannelId, mode } = c.req.valid('json');
    const count = await distributeCmsContents(ids, targetSiteId, targetChannelId, mode);
    return c.json(okBody(null, `已${mode === 'mapping' ? '映射' : '分发'} ${count} 条内容（同站内容自动跳过）`), 200);
  },
});

const importRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/import',
    tags: ['CMS-内容管理'], summary: '内容 Excel 批量导入（任务中心异步执行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: 'CMS 内容批量导入', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          fileId: z.string().min(1, '请先上传 Excel 文件'),
          siteId: z.number().int().positive(),
          channelId: z.number().int().positive(),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => {
    const { fileId, siteId, channelId } = c.req.valid('json');
    await ensureCmsContentTargetAccess(siteId, channelId);
    const row = await submitAsyncTask({
      taskType: 'cms-content-import',
      payload: { fileId, siteId, channelId },
      idempotencyKey: `cms-content-import-${fileId}`,
    });
    return c.json(okBody(mapAsyncTask(row), '导入任务已提交，可在任务中心查看进度'), 200);
  },
});

// ─── 归档（P1）────────────────────────────────────────────────────────────────
const archiveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/archive',
    tags: ['CMS-内容管理'], summary: '归档（批量，仅已发布/已下线内容；前台详情保留，不参与列表聚合）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容归档', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已归档') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await archiveCmsContents(ids);
    return c.json(okBody(null, `已归档 ${count} 条（仅已发布/已下线内容可归档）`), 200);
  },
});

const unarchiveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/unarchive',
    tags: ['CMS-内容管理'], summary: '取消归档（批量）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容取消归档', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已取消归档') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await unarchiveCmsContents(ids);
    return c.json(okBody(null, `已取消归档 ${count} 条`), 200);
  },
});

// ─── 操作日志 / 词库检查（P1）─────────────────────────────────────────────────
const opLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/op-logs',
    tags: ['CMS-内容管理'], summary: '内容操作日志时间线（新→旧，最近 100 条）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsContentOpLogDTO), '操作日志') },
  }),
  handler: async (c) => c.json(okBody(await listContentOpLogs(c.req.valid('param').id)), 200),
});

const checkTextRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/check-text',
    tags: ['CMS-内容管理'], summary: '内容词库检查（敏感词 + 易错词命中清单，编辑辅助）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update' })] as const,
    request: {
      body: {
        content: jsonContent(z.object({ text: z.string().max(200_000, '检查文本过长') })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(CmsTextCheckResultDTO, '命中清单') },
  }),
  handler: async (c) => c.json(okBody(await checkCmsText(c.req.valid('json').text)), 200),
});

const persistentLockRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/lock',
    tags: ['CMS-内容管理'], summary: '持久锁定内容（取消待执行计划发布时间）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:lock', audit: { description: '持久锁定 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(lockCmsContentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsContentLockDTO, '锁定成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsContent(id));
    return c.json(okBody(await lockCmsContent(id, c.req.valid('json').reason), '锁定成功'), 200);
  },
});

const persistentUnlockRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/unlock',
    tags: ['CMS-内容管理'], summary: '解除内容持久锁',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:lock', audit: { description: '解除 CMS 内容持久锁', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('解锁成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsContent(id));
    await unlockCmsContent(id);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});

router.openapiRoutes([
  listRoute, checkTitleRoute, getOneRoute, createRoute_, updateRoute_,
  submitRoute, publishRoute, rejectRoute, offlineRoute,
  recycleRoute, restoreRoute, purgeRoute,
  versionsRoute, restoreVersionRoute, versionDiffRoute,
  editLockAcquireRoute, editLockReleaseRoute, previewLinkRoute,
  batchMoveRoute, batchFlagsRoute, batchTagRoute, duplicateRoute, distributeRoute,
  importRoute, archiveRoute, unarchiveRoute, opLogsRoute, checkTextRoute,
  persistentLockRoute, persistentUnlockRoute,
] as const);

export default router;

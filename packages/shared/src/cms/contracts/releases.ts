import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { auditFieldsSchema, dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryEnum, requiredIdQuery } from '../../core/api-schemas';
import { activateCmsReleaseSchema, CMS_DEPLOYMENT_STATUSES, CMS_RELEASE_STATUSES, createCmsReleaseSchema, suppressCmsContentSchema } from '../release-validation';
import { CMS_RELEASE_SOURCES } from '../constants';
import { cmsReleaseReviewSchema } from './workbench';
import { recreateCmsReleaseSchema } from '../workbench-validation';

export const cmsReleaseItemSchema = z.object({ contentId: z.int(), revisionId: z.int().nullable(), title: z.string(), action: z.enum(['publish', 'withdraw']) });
export const cmsDeploymentSchema = z.object({
  id: z.int(), status: z.enum(CMS_DEPLOYMENT_STATUSES), manifestHash: z.string().nullable(),
  artifactCount: z.int(), error: z.string().nullable(), activatedAt: z.string().nullable(),
  buildPlan: z.object({ version: z.literal(1), phases: z.array(z.object({ key: z.string(), label: z.string(), dependsOn: z.array(z.string()), status: z.enum(['pending', 'running', 'completed', 'failed']), processed: z.int(), total: z.int() })) }),
  buildMetrics: z.object({ startedAt: z.string().optional(), completedAt: z.string().optional(), elapsedMs: z.int().optional(), reusedArtifacts: z.int().optional(), generatedArtifacts: z.int().optional(), peakMemoryMb: z.int().optional() }),
});
export type CmsDeployment = z.infer<typeof cmsDeploymentSchema>;
export const cmsReleaseActivationSchema = z.object({ id: z.int(), fromGenerationId: z.int().nullable(), toGenerationId: z.int(), action: z.enum(['activate', 'rollback']), operatorId: z.int().nullable(), operatorName: z.string(), createdAt: z.string() });
export const cmsReleaseSchema = z.object({
  id: z.int(), siteId: z.int(), name: z.string(), status: z.enum(CMS_RELEASE_STATUSES),
  source: z.enum(CMS_RELEASE_SOURCES),
  baseGenerationId: z.int().nullable(), deploymentId: z.int().nullable(), activateAt: z.string().nullable(),
  timeZone: z.string(), autoActivate: z.boolean(), error: z.string().nullable(), items: z.array(cmsReleaseItemSchema),
  configurationItems: z.array(z.object({ kind: z.enum(['site', 'page', 'widget']), id: z.int(), title: z.string() })),
  ...auditFieldsSchema, createdAt: z.string(), updatedAt: z.string(),
}).meta({ id: 'CmsRelease' });
export const cmsReleaseDetailSchema = cmsReleaseSchema.extend({
  deployment: cmsDeploymentSchema.nullable(), activeGenerationId: z.int().nullable(), blockingChecks: z.array(z.string()),
  activations: z.array(cmsReleaseActivationSchema),
});
export type CmsRelease = z.infer<typeof cmsReleaseSchema>;
export type CmsReleaseDetail = z.infer<typeof cmsReleaseDetailSchema>;
export const cmsReleaseContract = defineContract('/api/cms/releases', {
  list: op.get('/', { access: { permission: 'cms:publish:view' }, query: paginationQuery.extend({ siteId: requiredIdQuery('站点'), keyword: keywordQuery('发布单名称'), status: queryEnum(CMS_RELEASE_STATUSES), ...dateRangeQuery('创建时间') }), response: paginated(cmsReleaseSchema), summary: '发布单列表' }),
  detail: op.get('/{id}', { access: { permission: 'cms:publish:view' }, params: idParam, response: cmsReleaseDetailSchema, summary: '发布单与部署检查' }),
  review: op.get('/{id}/review', { access: { permission: 'cms:publish:view' }, params: idParam, response: cmsReleaseReviewSchema, summary: '相对当前线上版本的变更、检查与交付进度' }),
  recreate: op.post('/{id}/recreate', { access: { permission: 'cms:publish:build' }, params: idParam, body: recreateCmsReleaseSchema, response: cmsReleaseSchema, audit: '重新准备 CMS 发布单', summary: '在确认当前基代后创建待重新审阅的发布单' }),
  preview: op.get('/{id}/preview', { access: { permission: 'cms:publish:view' }, params: idParam, query: z.object({ path: z.string().max(1000).default('/') }), response: z.object({ html: z.string(), status: z.int(), path: z.string(), generationId: z.int() }), summary: '预览固定候选部署中的页面' }),
  create: op.post('/', { access: { permission: 'cms:publish:build' }, audit: '创建 CMS 发布单', body: createCmsReleaseSchema, response: cmsReleaseSchema, summary: '固定内容修订并创建发布单' }),
  build: op.post('/{id}/build', { access: { permission: 'cms:publish:build' }, audit: '构建 CMS 候选部署', params: idParam, response: cmsReleaseSchema, summary: '构建候选部署，不影响当前公开版本' }),
  activate: op.post('/{id}/activate', { access: { permission: 'cms:publish:manage' }, audit: '激活 CMS 发布单', params: idParam, body: activateCmsReleaseSchema, response: cmsReleaseSchema, summary: 'CAS 激活已完成的部署' }),
  cancel: op.post('/{id}/cancel', { access: { permission: 'cms:publish:manage' }, audit: '取消 CMS 发布单', params: idParam, response: cmsReleaseSchema, summary: '取消未激活的发布单' }),
  rollback: op.post('/{id}/rollback', { access: { permission: 'cms:publish:manage' }, audit: '回滚 CMS 部署', params: idParam, body: activateCmsReleaseSchema, response: cmsReleaseSchema, summary: '将历史部署重新激活' }),
  suppress: op.post('/content/{id}/suppress', { access: { permission: 'cms:content:publish' }, audit: '紧急撤下 CMS 内容', params: idParam, body: suppressCmsContentSchema, summary: '即时收窄公开可见性' }),
  unsuppress: op.post('/content/{id}/unsuppress', { access: { permission: 'cms:content:publish' }, audit: '解除 CMS 内容紧急撤下', params: idParam, body: suppressCmsContentSchema, summary: '恢复当前部署中的内容可见性' }),
}, { auditModule: 'CMS内容管理', tags: ['CMS-发布单'] });

/**
 * CMS 内容 ↔ 工作流审核桥接。
 *
 * 站点 settings.auditMode = 'workflow' 时，内容「提交审核」自动发起工作流实例
 * （bizType='cms_content'，definition 取 settings.auditWorkflowDefinitionId，
 * 缺省回退按名称「CMS 内容审核」查已发布定义）；
 * 流程通过 → 自动发布 + 刷新静态页 + 搜索引擎推送；驳回 / 撤回 → 回写内容状态。
 * 流程审核期间禁止后台手动发布 / 驳回，避免双轨状态漂移。
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES, type WorkflowBusinessPreview } from '@zenith/shared/workflow';
import type { BodyOf } from '@zenith/shared/core';
import { cmsContentContract } from '@zenith/shared/cms';
import { getBusinessWorkflowContext, previewBusinessWorkflow } from '../workflow/workflow-business-context.service';
import { getCmsContent } from './cms-contents-query.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { assertSiteAccess } from './cms-sites.service';
import { assertChannelAccess, ensureCmsChannelExists } from './cms-channels.service';
import { db } from '../../db';
import { cmsContentWorkingCopies, workflowDefinitions, workflowInstances } from '../../db/schema';
import logger from '../../lib/logger';
import { startWorkflowForBiz, onWorkflowResult } from '../../lib/workflow-biz-bridge';
import { approveCmsRevision, bindCmsReviewRevision, getCmsReviewRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';

export const CMS_CONTENT_BIZ_TYPE = 'cms_content';
const CMS_AUDIT_WORKFLOW_NAME = 'CMS 内容审核';

/** 站点是否启用工作流审核 */
export function isWorkflowAuditEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return (settings as Record<string, unknown> | null)?.auditMode === 'workflow';
}

async function resolveAuditDefinitionId(settings: Record<string, unknown>): Promise<number> {
  const configured = Number(settings.auditWorkflowDefinitionId);
  if (Number.isInteger(configured) && configured > 0) {
    const [def] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
      .where(and(
        isNull(workflowDefinitions.tenantId),
        eq(workflowDefinitions.id, configured),
        eq(workflowDefinitions.status, 'published'),
        eq(workflowDefinitions.formType, 'external'),
      ))
      .limit(1);
    if (def) return def.id;
    throw new HTTPException(400, { message: '站点配置的内容审核流程不存在、未发布或不是业务系统主导流程' });
  }
  const [fallback] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.name, CMS_AUDIT_WORKFLOW_NAME),
      isNull(workflowDefinitions.tenantId),
      eq(workflowDefinitions.status, 'published'),
      eq(workflowDefinitions.formType, 'external'),
    ))
    .orderBy(desc(workflowDefinitions.id))
    .limit(1);
  if (!fallback) {
    throw new HTTPException(400, { message: `未找到可用的内容审核流程定义，请在站点设置中选择或发布「${CMS_AUDIT_WORKFLOW_NAME}」流程` });
  }
  return fallback.id;
}

export function cmsContentWorkflowVariables(data: { title: string; siteName: string; channelName: string }): Record<string, unknown> {
  return { contentTitle: data.title, siteName: data.siteName, channelName: data.channelName };
}

export async function previewCmsContentWorkflow(data: BodyOf<typeof cmsContentContract.workflowPreview>): Promise<WorkflowBusinessPreview> {
  await assertSiteAccess(data.siteId);
  await assertChannelAccess(data.channelId);
  const channel = await ensureCmsChannelExists(data.channelId);
  if (channel.siteId !== data.siteId) throw new HTTPException(400, { message: '栏目不属于当前站点' });
  const site = await resolveEffectiveCmsSiteRow(data.siteId);
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  if (!isWorkflowAuditEnabled(settings)) return { definition: null, nodes: [] };
  return previewBusinessWorkflow(await resolveAuditDefinitionId(settings), cmsContentWorkflowVariables({
    title: data.title ?? '', siteName: site.name, channelName: channel.name,
  }));
}

export async function getCmsContentWorkflowContext(id: number, instanceId?: number) {
  const content = await getCmsContent(id);
  const current = content.submittedRevisionId ? 'latest' : null;
  return getBusinessWorkflowContext(CMS_CONTENT_BIZ_TYPE, String(id), current, instanceId);
}

/** 查内容当前活跃的审核流程实例（终态不算占用） */
export async function findActiveContentWorkflow(contentId: number) {
  const [instance] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.bizType, CMS_CONTENT_BIZ_TYPE),
      eq(workflowInstances.bizId, String(contentId)),
      inArray(workflowInstances.status, [...WORKFLOW_ACTIVE_INSTANCE_STATUSES]),
    ))
    .orderBy(desc(workflowInstances.id))
    .limit(1);
  return instance ?? null;
}

/** 流程审核中禁止手动发布/驳回（订阅回调走 fromWorkflow 旁路） */
export async function assertNoActiveContentWorkflow(contentId: number): Promise<void> {
  const active = await findActiveContentWorkflow(contentId);
  if (active) {
    throw new HTTPException(400, { message: `该内容正在工作流审核中（实例 #${active.id}），请在工作流待办中审批` });
  }
}

/** 提交审核时发起工作流（幂等：已有活跃实例直接复用） */
export async function startCmsContentWorkflow(input: {
  contentId: number;
  revisionId: number;
  revisionHash: string;
  title: string;
  siteName: string;
  channelName: string;
  settings: Record<string, unknown>;
  caller?: { userId: number; username: string; tenantId: null; roles?: string[] };
}) {
  const existing = await findActiveContentWorkflow(input.contentId);
  if (existing) return existing;
  const definitionId = await resolveAuditDefinitionId(input.settings);
  return startWorkflowForBiz({
    definitionId,
    title: `内容审核 - ${input.title}`,
    bizType: CMS_CONTENT_BIZ_TYPE,
    bizId: input.contentId,
    variables: { ...cmsContentWorkflowVariables(input), revisionId: input.revisionId, revisionHash: input.revisionHash },
    caller: input.caller,
  });
}

/**
 * 注册流程终态订阅：通过→发布+静态化+推送；驳回→rejected；撤回→draft。
 * 动态 import 避免 contents/static/push 服务与本模块的静态循环依赖。
 */
export function registerCmsWorkflowSubscribers(): void {
  onWorkflowResult(CMS_CONTENT_BIZ_TYPE, {
    onCreated: async (instance) => {
      const revisionId = Number(instance.formData?.revisionId);
      if (!Number.isInteger(revisionId) || revisionId <= 0) throw new HTTPException(409, { message: '内容审核实例缺少精确修订' });
      await bindCmsReviewRevision(Number(instance.bizId), instance.id, revisionId);
    },
    onApproved: async (instance) => {
      const contentId = Number(instance.bizId);
      const revision = await getCmsReviewRevision(contentId, instance.id);
      await db.transaction(async (tx) => {
        const working = await requireCmsWorkingCopy(tx, contentId, true);
        if (working.submittedRevisionId !== revision.id) throw new HTTPException(409, { message: '审核轮次不再是当前提交的修订' });
        await approveCmsRevision(tx, revision.id, instance.id);
        await tx.update(cmsContentWorkingCopies).set({ approvedRevisionId: revision.id,
          editorialStatus: working.editorialStatus === 'draft' ? 'draft' : 'approved',
          version: sql`${cmsContentWorkingCopies.version} + 1`,
        }).where(eq(cmsContentWorkingCopies.contentId, contentId));
      });
      const { publishCmsContent } = await import('./cms-contents.service');
      await publishCmsContent(contentId, { fromWorkflow: true, skipAccessCheck: true, revisionId: revision.id });
      logger.info(`[cms-workflow] 内容 #${contentId} 的修订 #${revision.id} 审核通过，发布单已提交`);
    },
    onRejected: async (instance) => {
      const contentId = Number(instance.bizId);
      const revision = await getCmsReviewRevision(contentId, instance.id);
      const { rejectCmsContent } = await import('./cms-contents.service');
      await rejectCmsContent(contentId, '工作流审核驳回', { fromWorkflow: true, skipAccessCheck: true, revisionId: revision.id });
    },
    onWithdrawn: async (instance) => {
      const contentId = Number(instance.bizId);
      const revision = await getCmsReviewRevision(contentId, instance.id);
      await db.update(cmsContentWorkingCopies).set({ editorialStatus: 'draft', submittedRevisionId: null, approvedRevisionId: null,
        version: sql`${cmsContentWorkingCopies.version} + 1`,
      }).where(and(eq(cmsContentWorkingCopies.contentId, contentId), eq(cmsContentWorkingCopies.submittedRevisionId, revision.id)));
    },
  });
}

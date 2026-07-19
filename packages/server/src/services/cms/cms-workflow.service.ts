/**
 * CMS 内容 ↔ 工作流审核桥接。
 *
 * 站点 settings.auditMode = 'workflow' 时，内容「提交审核」自动发起工作流实例
 * （bizType='cms_content'，definition 取 settings.auditWorkflowDefinitionId，
 * 缺省回退按名称「CMS 内容审核」查已发布定义）；
 * 流程通过 → 自动发布 + 刷新静态页 + 搜索引擎推送；驳回 / 撤回 → 回写内容状态。
 * 流程审核期间禁止后台手动发布 / 驳回，避免双轨状态漂移。
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { WORKFLOW_ACTIVE_INSTANCE_STATUSES } from '@zenith/shared';
import { db } from '../../db';
import { cmsContents, workflowDefinitions, workflowInstances } from '../../db/schema';
import logger from '../../lib/logger';
import { startWorkflowForBiz, onWorkflowResult } from '../../lib/workflow-biz-bridge';

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
      .where(and(eq(workflowDefinitions.id, configured), eq(workflowDefinitions.status, 'published')))
      .limit(1);
    if (def) return def.id;
  }
  const [fallback] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.name, CMS_AUDIT_WORKFLOW_NAME),
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
  title: string;
  siteName: string;
  channelName: string;
  settings: Record<string, unknown>;
}) {
  const existing = await findActiveContentWorkflow(input.contentId);
  if (existing) return existing;
  const definitionId = await resolveAuditDefinitionId(input.settings);
  return startWorkflowForBiz({
    definitionId,
    title: `内容审核 - ${input.title}`,
    bizType: CMS_CONTENT_BIZ_TYPE,
    bizId: input.contentId,
    variables: {
      contentTitle: input.title,
      siteName: input.siteName,
      channelName: input.channelName,
    },
  });
}

/**
 * 注册流程终态订阅：通过→发布+静态化+推送；驳回→rejected；撤回→draft。
 * 动态 import 避免 contents/static/push 服务与本模块的静态循环依赖。
 */
export function registerCmsWorkflowSubscribers(): void {
  onWorkflowResult(CMS_CONTENT_BIZ_TYPE, {
    onApproved: async (instance) => {
      const contentId = Number(instance.bizId);
      try {
        // 复验内容当前状态：长周期流程通过时内容可能已被回收/驳回/下线，仅待审状态才自动发布
        const [current] = await db.select({ status: cmsContents.status, deletedAt: cmsContents.deletedAt })
          .from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
        if (!current || current.deletedAt || current.status !== 'pending') {
          logger.warn(`[cms-workflow] 内容 #${contentId} 流程通过但当前状态不可发布（status=${current?.status ?? '不存在'}），跳过自动发布`);
          return;
        }
        const { publishCmsContent } = await import('./cms-contents.service');
        await publishCmsContent(contentId, { fromWorkflow: true });
        const { triggerContentStaticRefresh } = await import('./cms-static.service');
        const { triggerAutoPushForContent } = await import('./cms-push.service');
        triggerContentStaticRefresh(contentId);
        triggerAutoPushForContent(contentId);
        logger.info(`[cms-workflow] 内容 #${contentId} 流程审核通过，已自动发布`);
      } catch (err) {
        logger.error(`[cms-workflow] 内容 #${contentId} 流程通过后发布失败`, err);
      }
    },
    onRejected: async (instance) => {
      const contentId = Number(instance.bizId);
      try {
        const { rejectCmsContent } = await import('./cms-contents.service');
        await rejectCmsContent(contentId, '工作流审核驳回', { fromWorkflow: true });
        logger.info(`[cms-workflow] 内容 #${contentId} 流程审核驳回`);
      } catch (err) {
        logger.error(`[cms-workflow] 内容 #${contentId} 流程驳回回写失败`, err);
      }
    },
    onWithdrawn: async (instance) => {
      const contentId = Number(instance.bizId);
      try {
        await db.update(cmsContents)
          .set({ status: 'draft' })
          .where(and(eq(cmsContents.id, contentId), eq(cmsContents.status, 'pending')));
        logger.info(`[cms-workflow] 内容 #${contentId} 流程撤回，已退回草稿`);
      } catch (err) {
        logger.error(`[cms-workflow] 内容 #${contentId} 流程撤回回写失败`, err);
      }
    },
  });
}

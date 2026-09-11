/**
 * 审批单归档件生成的作业声明与事件订阅（轻量模块，供 bootstrap 直接引用）。
 * 真正的渲染 / 落盘在 workflow-print.service（pdfkit、报表渲染、托管文件等大模块图），只在作业执行时按需加载。
 */
import logger from '../../lib/logger';
import { registerSystemQueueWorker, sendSystemJob } from '../../lib/pg-boss-scheduler';
import { workflowEventBus } from '../../lib/workflow-event-bus';
import { loadDefinitionPrintConfig } from './workflow-print-config';

export const WORKFLOW_PRINT_ARCHIVE_QUEUE = 'workflow-print-archive';

/** 队列 worker 声明（所有角色声明，worker 角色执行） */
export async function registerWorkflowPrintArchiveWorker(): Promise<void> {
  await registerSystemQueueWorker<{ instanceId: number }>({
    name: WORKFLOW_PRINT_ARCHIVE_QUEUE,
    title: '审批单归档件生成',
    module: '工作流',
    description: '流程进入通过 / 驳回终态后，按流程「审批单打印 → 自动归档」设置生成 PDF 存证',
    queueOptions: { retryLimit: 3, retryDelay: 60, expireInSeconds: 600 },
    handler: async (job) => {
      const { archiveWorkflowInstancePrint } = await import('./workflow-print.service');
      const outcome = await archiveWorkflowInstancePrint(job.instanceId);
      return outcome.archived ? `实例 #${job.instanceId} 已归档` : `实例 #${job.instanceId} 跳过：${outcome.reason}`;
    },
  });
}

/** 终态事件 → 投递归档作业（发出事件的进程投递；singletonKey 去重，重复投递幂等） */
export function registerWorkflowPrintArchiveSubscriber(): void {
  const enqueue = async (event: { instance: { id: number; definitionId: number } }) => {
    try {
      const definitionPrint = await loadDefinitionPrintConfig(event.instance.definitionId);
      if (!definitionPrint.settings.autoArchive) return;
      await sendSystemJob(WORKFLOW_PRINT_ARCHIVE_QUEUE, { instanceId: event.instance.id }, { singletonKey: `archive:${event.instance.id}`, singletonSeconds: 600 });
    } catch (err) {
      logger.error('[workflow-print] 归档作业投递失败', { instanceId: event.instance.id, err });
    }
  };
  workflowEventBus.on('instance.approved', enqueue);
  workflowEventBus.on('instance.rejected', enqueue);
}

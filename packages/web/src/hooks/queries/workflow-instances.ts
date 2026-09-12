// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InputOf, QueryOf } from '@zenith/shared/core';
import {
  workflowAutomationContract,
  workflowConnectorContract,
  workflowEngineContract,
  workflowEventSubscriptionContract,
  workflowHealthContract,
  workflowInstanceContract,
  workflowInstanceOpsContract,
  workflowTaskContract,
  workflowTriggerExecutionContract,
} from '@zenith/shared/workflow';
import { api, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { compactQuery } from '@/lib/query';
import { request } from '@/utils/request';

export type WorkflowInstanceListParams = QueryOf<typeof workflowInstanceContract.list>;

/** 已办 / 抄送列表参数（分页 + 关键字） */
export type WorkflowInstanceKeywordListParams = QueryOf<typeof workflowInstanceContract.handledMine>;

export const workflowInstanceKeys = {
  /** 「我的申请」全部分页 / 筛选条件的公共前缀 */
  lists: contractKey(workflowInstanceContract.list),
  list: (params: WorkflowInstanceListParams) => contractKey(workflowInstanceContract.list, { query: params }),
  handledLists: contractKey(workflowInstanceContract.handledMine),
  handled: (params: WorkflowInstanceKeywordListParams) => contractKey(workflowInstanceContract.handledMine, { query: params }),
  ccLists: contractKey(workflowInstanceContract.ccMine),
  cc: (params: WorkflowInstanceKeywordListParams) => contractKey(workflowInstanceContract.ccMine, { query: params }),
  /** 全部实例详情的公共前缀（同时覆盖审批面板「实例 + 定义」组合查询，见 workflow-shared） */
  details: contractKey(workflowInstanceContract.detail),
  detail: (id: number) => contractKey(workflowInstanceContract.detail, { params: { id } }),
};

export function useMyWorkflowInstances(params: WorkflowInstanceListParams) {
  return useApiQuery(workflowInstanceContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useHandledWorkflowInstances(params: WorkflowInstanceKeywordListParams) {
  return useApiQuery(workflowInstanceContract.handledMine, { query: params }, { placeholderData: keepPreviousData });
}

export function useCcWorkflowInstances(params: WorkflowInstanceKeywordListParams) {
  return useApiQuery(workflowInstanceContract.ccMine, { query: params }, { placeholderData: keepPreviousData });
}

/**
 * 实例运行状态变化（发起 / 提交 / 撤回 / 抄送 / 审批动作 / 管理员干预 / 引擎补投）后回源的查询。
 * 契约 key 下没有 ['workflow'] 这样的域根可广播，这里逐项列出会读到被改状态的界面：
 * - 我的申请 / 已办 / 抄送列表：列表项带状态、当前节点、我的处理结果与未读标记
 * - 待办列表、待办 / 抄送未读计数、我的协办：任务随实例推进增减
 * - 实例详情（前缀同时覆盖审批面板的「实例 + 定义」组合查询）：任务、评论、协办、预测路径
 * - 实例监控列表与统计卡、任务监控、超时预警、数据分析、健康汇总：都是实例 / 任务状态的聚合
 * - 实例诊断 / 轨迹 / 执行 Token（传 instanceId 时只失效该实例）
 * - 作业账本列表与汇总、引擎内省：推进会入队或取消定时、触发器、子流程作业
 * - 触发器执行、自动化执行记录、事件投递、连接器调用统计：均由实例事件产生
 * 刻意不碰：流程定义 / 表单 / 设计器 lookup（编辑态查询被动 refetch 会覆盖未保存的画布）、
 * 已发布定义下拉、作业运行状态（worker 心跳）、保存视图 / 日程 / 代理规则。
 * 未挂载的查询只被标脏，代价接近零；同屏挂载的都确实需要刷新。
 */
export function invalidateAfterInstanceChange(qc: QueryClient, instanceId?: number): void {
  const invalidate = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });
  invalidate(workflowInstanceKeys.lists);
  invalidate(workflowInstanceKeys.handledLists);
  invalidate(workflowInstanceKeys.ccLists);
  invalidate(contractKey(workflowInstanceContract.pendingMine));
  invalidate(contractKey(workflowInstanceContract.pendingMineCount));
  invalidate(contractKey(workflowInstanceContract.ccUnreadCount));
  invalidate(contractKey(workflowTaskContract.myConsults));
  invalidate(instanceId === undefined ? workflowInstanceKeys.details : workflowInstanceKeys.detail(instanceId));
  invalidate(contractKey(workflowInstanceContract.monitor));
  invalidate(contractKey(workflowTaskContract.taskMonitor));
  invalidate(contractKey(workflowInstanceContract.overdue));
  invalidate(contractKey(workflowInstanceContract.analytics));
  invalidate(contractKey(workflowHealthContract.summary));
  invalidate(instanceId === undefined
    ? contractKey(workflowInstanceOpsContract.diagnostics)
    : contractKey(workflowInstanceOpsContract.diagnostics, { params: { id: instanceId } }));
  invalidate(instanceId === undefined
    ? contractKey(workflowInstanceOpsContract.trace)
    : contractKey(workflowInstanceOpsContract.trace, { params: { id: instanceId } }));
  invalidate(instanceId === undefined
    ? contractKey(workflowInstanceOpsContract.tokens)
    : contractKey(workflowInstanceOpsContract.tokens, { params: { id: instanceId } }));
  invalidate(contractKey(workflowEngineContract.jobs));
  invalidate(contractKey(workflowEngineContract.jobsSummary));
  invalidate(contractKey(workflowEngineContract.introspection));
  invalidate(contractKey(workflowTriggerExecutionContract.list));
  invalidate(contractKey(workflowAutomationContract.runs));
  invalidate(contractKey(workflowEventSubscriptionContract.deliveries));
  invalidate(contractKey(workflowConnectorContract.stats));
}

export type CreateWorkflowInstanceVariables = InputOf<typeof workflowInstanceContract.create> & {
  /** 按表单指纹传入以防连点；缺省由服务端自动指纹兜底 */
  idempotencyKey?: string;
};

/** H5：幂等键按调用方传入的表单指纹逐次进入请求头，契约未声明 headers 段，无法经 useApiMutation 传入 */
export function useCreateWorkflowInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: CreateWorkflowInstanceVariables) =>
      api(workflowInstanceContract.create, { body }, idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : undefined),
    // 发起（或存草稿）新增一条申请并立即产生首个待办 / 作业
    onSuccess: (created) => invalidateAfterInstanceChange(qc, created.id),
  });
}

export function useUpdateWorkflowDraft() {
  return useApiMutation(workflowInstanceContract.updateDraft, {
    // 草稿编辑只改自己的申请单：列表项（标题 / 摘要）与详情回源，不产生任务与作业
    invalidate: (qc, _saved, { params }) => {
      void qc.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
      void qc.invalidateQueries({ queryKey: workflowInstanceKeys.detail(params.id) });
    },
  });
}

export function useSubmitWorkflowDraft() {
  return useApiMutation(workflowInstanceContract.submitDraft, {
    invalidate: (qc, _saved, { params }) => invalidateAfterInstanceChange(qc, params.id),
  });
}

export function useDeleteWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.remove, {
    invalidate: (qc, _output, { params }) => {
      // 实体已不存在：移除详情（含组合查询）而非失效，否则仍挂载的面板会去请求一个必然 404 的资源
      qc.removeQueries({ queryKey: workflowInstanceKeys.detail(params.id) });
      invalidateAfterInstanceChange(qc, params.id);
    },
  });
}

export function useResubmitWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.resubmit, {
    // 克隆为新草稿：只在「我的申请」多出一行，原实例与任务不变
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowInstanceKeys.lists }),
  });
}

export function useWithdrawWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.withdraw, {
    invalidate: (qc, _saved, { params }) => invalidateAfterInstanceChange(qc, params.id),
  });
}

export interface WorkflowInstancePrintPdf {
  blob: Blob;
  filename: string;
  /** archive = 服务端直接返回的归档原件；live = 本次实时渲染 */
  source: 'archive' | 'live';
}

export interface WorkflowInstancePrintOptions {
  /** 临时指定模板（设计器预览）；指定后服务端忽略归档件 */
  templateId?: number;
  /** auto（默认）优先归档件；live 强制按当前版式重渲；archive 只要归档件 */
  source?: 'auto' | 'archive' | 'live';
}

/**
 * 审批单 PDF：预览 / 打印 / 下载共用同一份文件。二进制通道不走 api()，经 request.fetchRaw 取 Blob
 * 与响应头文件名；失败时服务端返回标准 JSON 信封，取其 message 抛出供调用方提示。
 */
export async function fetchWorkflowInstancePrintPdf(id: number, options: WorkflowInstancePrintOptions = {}): Promise<WorkflowInstancePrintPdf> {
  const query = compactQuery({ templateId: options.templateId, source: options.source });
  const res = await request.fetchRaw(urlOf(workflowInstanceContract.print, { params: { id }, query }));
  if (!res) throw new Error('审批单生成失败');
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `审批单生成失败（HTTP ${res.status}）`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return {
    blob,
    filename: match ? decodeURIComponent(match[1]) : `审批单-${id}.pdf`,
    source: res.headers.get('x-zenith-print-source') === 'archive' ? 'archive' : 'live',
  };
}

export function useBatchWithdrawWorkflowInstances() {
  return useApiMutation(workflowInstanceContract.batchWithdraw, {
    invalidate: (qc) => invalidateAfterInstanceChange(qc),
  });
}

/**
 * 催办只新增催办记录并通知审批人，不改变实例 / 任务状态；管理端没有查询读取催办历史，
 * 仅失效历史端点前缀以备详情场景挂载。
 */
const invalidateUrgeHistory = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: contractKey(workflowInstanceContract.urges) });
  void qc.invalidateQueries({ queryKey: contractKey(workflowTaskContract.taskUrges) });
};

export function useUrgeWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.urge, { invalidate: invalidateUrgeHistory });
}

export function useBatchUrgeWorkflowInstances() {
  return useApiMutation(workflowInstanceContract.batchUrge, { invalidate: invalidateUrgeHistory });
}

/** 运行中补加抄送：实例多出抄送任务（详情 / 任务监控可见），接收人的抄送列表与未读数变化 */
export function useAddWorkflowCc() {
  return useApiMutation(workflowInstanceContract.addCc, {
    invalidate: (qc, _tasks, { params }) => invalidateAfterInstanceChange(qc, params.id),
  });
}

export function useForwardWorkflowCc() {
  return useApiMutation(workflowInstanceContract.forward, {
    invalidate: (qc, _output, { params }) => invalidateAfterInstanceChange(qc, params.id),
  });
}

export function useMarkWorkflowCcRead() {
  return useApiMutation(workflowInstanceContract.ccRead, {
    // 只改我这条抄送的已读标记：抄送列表（未读样式）与未读计数回源
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: workflowInstanceKeys.ccLists });
      void qc.invalidateQueries({ queryKey: contractKey(workflowInstanceContract.ccUnreadCount) });
    },
  });
}

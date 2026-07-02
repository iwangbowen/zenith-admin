/** 任务中心队列名（pg-boss） */
export const ASYNC_TASK_QUEUE = 'async-tasks';

/** running 任务心跳超过该时长视为卡死（进程崩溃/重启），由兜底扫描回收 */
export const HEARTBEAT_STALE_MS = 90_000;

/** pending 任务超过该时长仍未被领取时兜底重投（如队列消息丢失） */
export const PENDING_REDISPATCH_MS = 3 * 60_000;

/** 已结束任务默认保留天数（自动清理） */
export const ASYNC_TASK_RETENTION_DAYS = 30;

export interface TaskProgressUpdate {
  /** 已处理数 */
  processed?: number;
  /** 失败数 */
  failed?: number;
  /** 总量；null 表示不可枚举（前端显示不定进度条） */
  total?: number | null;
  /** 进度说明文案 */
  note?: string | null;
  /** 断点状态（handler 自定义结构），中断恢复时通过 ctx.checkpoint 取回 */
  checkpoint?: Record<string, unknown> | null;
}

export interface TaskProgressResult {
  /** true：用户已请求取消（或任务已被回收），handler 应尽快保存状态并 return */
  cancelRequested: boolean;
}

export interface TaskRunContext {
  taskId: number;
  /** 任务入参 */
  payload: Record<string, unknown>;
  /** 上次中断时保存的断点状态；首次执行为 null */
  checkpoint: Record<string, unknown> | null;
  /** 第几次领取执行（首次为 1；断点恢复/兜底重跑会递增，重新开始清零） */
  attempt: number;
  /** 上报进度 + 持久化断点 + 刷新心跳 + WS 推送，返回是否已请求取消 */
  progress(update: TaskProgressUpdate): Promise<TaskProgressResult>;
  /** 单独查询是否已请求取消（progress 的返回值已包含该信息） */
  isCancelRequested(): Promise<boolean>;
}

export interface TaskHandlerRegistration {
  /** 任务类型唯一标识（小写中划线，如 member-batch-import） */
  taskType: string;
  /** 默认任务标题（提交时可覆盖） */
  title: string;
  /** 所属模块（展示用） */
  module: string;
  description?: string;
  /** false：同一用户存在未结束的同类型任务时禁止重复提交（默认 true 允许） */
  allowConcurrent?: boolean;
  /** 任务执行体；返回值写入 result 字段。抛错 → failed；期间应周期调用 ctx.progress() */
  run(ctx: TaskRunContext): Promise<Record<string, unknown> | void>;
}

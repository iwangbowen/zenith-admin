/**
 * 异步任务表格公共列工厂 —— 任务中心与业务 Demo 页（任务中心接入示例）共用。
 *
 * 与 workflow-task-columns.tsx 同一思路：按列复用而非合并整表。
 * 收敛的是「列渲染语义」：任务状态 Tag（含取消中 / 等待重试两个派生态）与任务项明细列。
 */
import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { AsyncTask, AsyncTaskItem, AsyncTaskItemStatus, AsyncTaskStatus } from '@zenith/shared/tasks';
import { ASYNC_TASK_ITEM_STATUS_TAG_MAP, ASYNC_TASK_STATUS_TAG_MAP } from '@/utils/async-task';
import { renderEllipsis } from '@/utils/table-columns';

/** 任务状态 Tag：执行中且已请求取消 → 「取消中」，排队中且有下次执行时间 → 「等待重试」，其余按状态映射 */
export function renderAsyncTaskStatus(value: AsyncTaskStatus, record: Pick<AsyncTask, 'cancelRequested' | 'nextRunAt'>) {
  if (value === 'running' && record.cancelRequested) return <Tag color="orange">取消中</Tag>;
  if (value === 'pending' && record.nextRunAt) return <Tag color="orange">等待重试</Tag>;
  const meta = ASYNC_TASK_STATUS_TAG_MAP[value];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 状态列：固定在操作列左侧 */
export function asyncTaskStatusColumn<T extends AsyncTask = AsyncTask>(width = 110): ColumnProps<T> {
  return {
    title: '状态',
    dataIndex: 'status',
    width,
    fixed: 'right',
    render: (value: AsyncTaskStatus, record: T) => renderAsyncTaskStatus(value, record),
  };
}

export function renderAsyncTaskItemStatus(value: AsyncTaskItemStatus) {
  const meta = ASYNC_TASK_ITEM_STATUS_TAG_MAP[value];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 任务项明细表（标识 / 名称 / 状态 / 信息 / 执行轮次） */
export function asyncTaskItemColumns(widths: { itemKey?: number; label?: number } = {}): ColumnProps<AsyncTaskItem>[] {
  return [
    { title: '标识', dataIndex: 'itemKey', width: widths.itemKey ?? 120 },
    { title: '名称', dataIndex: 'label', width: widths.label ?? 150, render: (value: string | null) => value ?? '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: AsyncTaskItemStatus) => renderAsyncTaskItemStatus(value) },
    { title: '信息', dataIndex: 'message', width: 220, render: renderEllipsis },
    { title: '执行轮次', dataIndex: 'attempt', width: 90 },
  ];
}

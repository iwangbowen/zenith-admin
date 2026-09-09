/** 发送日志（邮件 / 短信）表格共用列 */
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import type { SendStatus } from '@zenith/shared/messaging';
import { renderEllipsis } from '@/utils/table-columns';
import { SEND_SOURCE_OPTIONS as SOURCE_OPTIONS } from './send-log-constants';
import { SendStatusTag } from './send-log-ui';

export function sendLogSourceColumn<T extends Data = Data>(): ColumnProps<T> {
  return { title: '来源', dataIndex: 'source', width: 90, render: (v: string) => SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v };
}

export function sendLogOperatorColumn<T extends Data = Data>(): ColumnProps<T> {
  return { title: '操作人', dataIndex: 'userName', width: 120, render: (v: string | null) => v || '—' };
}

export function sendLogErrorColumn<T extends Data = Data>(): ColumnProps<T> {
  return { title: '错误信息', dataIndex: 'errorMsg', render: renderEllipsis };
}

export function sendLogStatusColumn<T extends Data = Data>(): ColumnProps<T> {
  return { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: SendStatus) => <SendStatusTag value={v} /> };
}

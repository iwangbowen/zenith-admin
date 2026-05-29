/**
 * 通用表格列工具
 *
 * 提供常用的预置列对象和 render 辅助函数，避免在每个页面重复手写。
 */
import { Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime } from './date';

/**
 * 带省略 tooltip 的文本 render，空值自动显示 '—'
 *
 * @example
 * { title: '描述', dataIndex: 'description', render: renderEllipsis }
 */
export function renderEllipsis(v: string | null | undefined): React.ReactNode {
  return (
    <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
      {v || '—'}
    </Typography.Text>
  );
}

/**
 * 创建时间列（固定宽度 180，自动格式化为 YYYY-MM-DD HH:mm:ss）
 *
 * @example
 * const columns = [..., createdAtColumn];
 */
export const createdAtColumn: ColumnProps = {
  title: '创建时间',
  dataIndex: 'createdAt',
  width: 180,
  render: (v: string) => formatDateTime(v),
};

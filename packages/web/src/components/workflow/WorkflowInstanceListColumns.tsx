/* eslint-disable react-refresh/only-export-components */
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';

type InstanceStatusColumnOptions = {
  title?: string;
  dataIndex?: string;
};

export function WorkflowInstanceStatusTag({ status }: Readonly<{ status: string }>) {
  const meta = INSTANCE_STATUS_MAP[status];
  return <Tag color={meta?.color ?? 'grey'}>{meta?.text ?? status}</Tag>;
}

export function workflowInstanceTitleColumn<T extends Data>(): ColumnProps<T> {
  return { title: '申请标题', dataIndex: 'title', minWidth: 200, render: renderEllipsis };
}

export function workflowSerialNoColumn<T extends Data>(): ColumnProps<T> {
  return { title: '业务编号', dataIndex: 'serialNo', width: 130, render: (value: string | null) => value ?? '—' };
}

export function workflowDefinitionNameColumn<T extends Data>(): ColumnProps<T> {
  return { title: '流程名称', dataIndex: 'definitionName', width: 160, render: renderEllipsis };
}

export function workflowInitiatorColumn<T extends Data>(): ColumnProps<T> {
  return {
    title: '发起人',
    dataIndex: 'initiatorName',
    width: 150,
    render: (value: string | null) => (value
      ? <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{value}</Typography.Text>
      : <span style={{ color: 'var(--semi-color-text-2)' }}>{EMPTY_PLACEHOLDER}</span>),
  };
}

export function workflowInstanceStatusColumn<T extends Data>(
  options: InstanceStatusColumnOptions = {},
): ColumnProps<T> {
  return {
    title: options.title ?? '状态',
    dataIndex: options.dataIndex ?? 'status',
    width: 80,
    fixed: 'right',
    render: (value: string) => <WorkflowInstanceStatusTag status={value} />,
  };
}

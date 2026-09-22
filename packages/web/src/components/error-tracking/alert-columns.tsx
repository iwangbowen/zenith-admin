/**
 * 错误告警规则 / 触发历史表格列：前端错误监控与服务端异常日志共用。
 * 动作（编辑 / 测试 / 删除 / 启停）由页面注入，列宽与文案在此统一。
 */
import { Switch, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ErrorAlertLog, ErrorAlertRule } from '@zenith/shared/analytics';
import { ERROR_ALERT_CONDITION_LABELS } from '@zenith/shared/analytics';
import { deleteAction } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, overflowTagColumn } from '@/utils/table-columns';
import { alertChannelMeta } from './issue-meta';
import { ErrorLevelTag, ErrorTypeTag } from './issue-atoms';

const EMPTY_CHANNELS = <Typography.Text type="tertiary">未配置</Typography.Text>;

/** 告警渠道列：逐渠道配色取自渠道元数据，与前端错误 / 服务端异常两个告警列表共用 */
function alertChannelsColumn<T extends { channels: readonly string[] }>(): ColumnProps<T> {
  return overflowTagColumn<T>({
    title: '渠道',
    dataIndex: 'channels',
    width: 180,
    contentWidth: 148,
    getItems: (channels) => ((channels as readonly string[] | undefined) ?? []).map((channel) => {
      const meta = alertChannelMeta(channel);
      return { key: channel, label: meta.label, color: meta.color };
    }),
    popoverWidth: 180,
    empty: EMPTY_CHANNELS,
  });
}

export interface ErrorAlertRuleColumnActions {
  readonly onEdit: (rule: ErrorAlertRule) => void;
  readonly onTest: (rule: ErrorAlertRule) => Promise<void>;
  readonly onToggle: (rule: ErrorAlertRule, enabled: boolean) => Promise<void>;
  readonly onDelete: (rule: ErrorAlertRule) => Promise<unknown>;
}

export function errorAlertRuleColumns(actions: ErrorAlertRuleColumnActions): ColumnProps<ErrorAlertRule>[] {
  return [
    { title: '名称', dataIndex: 'name', minWidth: 180 },
    { title: '条件', dataIndex: 'condition', width: 100, render: (_value, record) => ERROR_ALERT_CONDITION_LABELS[record.condition] },
    { title: '阈值', dataIndex: 'thresholdCount', width: 90, align: 'right' },
    { title: '窗口', dataIndex: 'windowMinutes', width: 110, align: 'right', render: (value) => `${value} 分钟` },
    { title: '类型', dataIndex: 'errorType', width: 130, render: (_value, record) => (record.errorType ? <ErrorTypeTag type={record.errorType} /> : <Tag color="grey">全部</Tag>) },
    { title: '级别', dataIndex: 'level', width: 110, render: (_value, record) => (record.level ? <ErrorLevelTag level={record.level} /> : <Tag color="grey">全部</Tag>) },
    alertChannelsColumn<ErrorAlertRule>(),
    dateTimeColumn('最近触发', 'lastTriggeredAt'),
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      fixed: 'right',
      render: (_value, record) => <Switch size="small" checked={record.enabled} onChange={(checked) => void actions.onToggle(record, checked)} />,
    },
    createOperationColumn<ErrorAlertRule>({
      width: 210,
      desktopInlineKeys: ['edit', 'test', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', onClick: () => actions.onEdit(record) },
        { key: 'test', label: '测试', onClick: () => { void actions.onTest(record); } },
        deleteAction({
          title: '确定删除该告警规则？',
          run: () => actions.onDelete(record),
        }),
      ],
    }),
  ];
}

export function errorAlertLogColumns(): ColumnProps<ErrorAlertLog>[] {
  return [
    dateTimeColumn('触发时间', 'createdAt'),
    { title: '规则', dataIndex: 'ruleName', width: 180 },
    { title: '条件', dataIndex: 'condition', width: 100, render: (_value, record) => ERROR_ALERT_CONDITION_LABELS[record.condition] },
    { title: '详情', dataIndex: 'detail' },
    alertChannelsColumn<ErrorAlertLog>(),
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (_value, record) => (
        <Tag color={record.source === 'realtime' ? 'orange' : record.source === 'test' ? 'grey' : 'blue'}>
          {record.source === 'realtime' ? '实时触发' : record.source === 'test' ? '测试发送' : '定时评估'}
        </Tag>
      ),
    },
  ];
}

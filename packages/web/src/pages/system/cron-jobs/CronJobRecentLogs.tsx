import { useMemo } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CronJobLog, CronRunStatus, CronRunTrigger } from '@zenith/shared/platform';
import { CRON_RUN_STATUSES, CRON_RUN_STATUS_OPTIONS, CRON_RUN_TRIGGERS, CRON_RUN_TRIGGER_LABELS, CRON_RUN_TRIGGER_OPTIONS } from '@zenith/shared/platform';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import type { UseListSearchReturn } from '@/hooks/useListSearch';
import { useCronJobAllLogs } from '@/hooks/queries/cron-jobs';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { formatDurationMs } from '@/utils/format';
import { DATE_TIME_COLUMN_WIDTH, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { compactParams } from '@/lib/query';
import { RelativeTime, TRIGGER_TAG, statusMeta, type RecentLogsSearchParams } from './cron-dashboard-shared';

interface Props {
  readonly jobOptions: readonly { value: number; label: string }[];
  readonly now: Date;
  /** 搜索状态由父级持有，便于失败原因榜单点击时 `applySearch` 直接下发条件 */
  readonly search: UseListSearchReturn<RecentLogsSearchParams>;
  readonly onViewLogs: (jobId: number, jobName: string) => void;
}

/** 执行记录：可按状态 / 任务 / 关键字 / 时间筛选的分页表 */
export function CronJobRecentLogs({ jobOptions, now, search, onViewLogs }: Props) {
  const { page, pageSize, buildPagination, bind, bindKeyword, submittedParams, handleSearch, handleReset } = search;
  const query = useMemo(() => compactParams({
    page,
    pageSize,
    keyword: submittedParams.keyword,
    status: submittedParams.status,
    trigger: submittedParams.trigger,
    jobId: submittedParams.jobId,
    ...formatDateTimeRangeForApi(submittedParams.range),
  }), [page, pageSize, submittedParams]);
  const logsQuery = useCronJobAllLogs(query);

  const columns: ColumnProps<CronJobLog>[] = [
    {
      // 复合列：精确时刻 + 相对时间
      title: '开始时间', dataIndex: 'startedAt', width: DATE_TIME_COLUMN_WIDTH,
      render: (v: string) => (
        <div className="cron-cell">
          <span>{v}</span>
          <RelativeTime value={v} now={now} className="cron-cell__sub" />
        </div>
      ),
    },
    {
      title: '任务', dataIndex: 'jobName', width: 180,
      render: (v: string, r: CronJobLog) => (
        <div className="cron-cell">
          <Typography.Text link ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }} onClick={() => onViewLogs(r.jobId, r.jobName)}>{v}</Typography.Text>
          <span className="cron-cell__sub">第 {r.executionCount} 次</span>
        </div>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: CronRunStatus) => {
        const meta = statusMeta(v);
        return <Tag color={meta.tag} size="small" type="light">{meta.label}</Tag>;
      },
    },
    {
      title: '触发', dataIndex: 'trigger', width: 96,
      render: (v: CronRunTrigger, r: CronJobLog) => (
        <div className="cron-cell">
          <span><Tag color={TRIGGER_TAG[v]} size="small" type="light">{CRON_RUN_TRIGGER_LABELS[v]}</Tag></span>
          {r.attempt > 0 && <span className="cron-cell__sub">第 {r.attempt} 次重试</span>}
        </div>
      ),
    },
    {
      title: '耗时', dataIndex: 'durationMs', width: 96, align: 'right',
      render: (v: number | null, r: CronJobLog) => (r.status === 'running' ? <span style={{ color: 'var(--semi-color-text-2)' }}>运行中</span> : formatDurationMs(v)),
    },
    {
      title: '调度延迟', dataIndex: 'latencyMs', width: 100, align: 'right',
      render: (v: number | null, r: CronJobLog) => (
        <span title={r.scheduledAt ? `计划 ${r.scheduledAt}` : undefined} style={v != null && v >= 10_000 ? { color: 'var(--semi-color-warning)' } : undefined}>
          {formatDurationMs(v == null ? null : Math.max(v, 0))}
        </span>
      ),
    },
    dateTimeColumn('结束时间', 'endedAt'),
    {
      title: '节点', dataIndex: 'nodeId', width: 150,
      render: (v: string | null) => <span className="cron-mono" style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{renderEllipsis(v)}</span>,
    },
    {
      title: '输出 / 错误', dataIndex: 'output', minWidth: 240,
      render: (v: string | null, r: CronJobLog) => (r.errorMessage
        ? <span style={{ color: 'var(--semi-color-danger)' }}>{renderEllipsis(r.errorMessage)}</span>
        : renderEllipsis(v)),
    },
  ];

  return (
    <>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索任务名称 / 输出 / 错误" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <StatusSelect items={CRON_RUN_STATUS_OPTIONS} {...bind('status', (v) => enumValueOf(CRON_RUN_STATUSES, v))} />
            <FilterSelect placeholder="全部触发方式" items={CRON_RUN_TRIGGER_OPTIONS} {...bind('trigger', (v) => enumValueOf(CRON_RUN_TRIGGERS, v))} />
            <FilterSelect<number> placeholder="全部任务" items={jobOptions} width={180} {...bind('jobId')} />
            <DateRangeFilter {...bind('range')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="执行记录筛选"
      />
      <ConfigurableTable<CronJobLog>
        columnSettingsKey="cron-jobs-recent-logs"
        columns={columns}
        {...listTableProps(logsQuery, { pagination: buildPagination, empty: '暂无执行记录' })}
      />
    </>
  );
}

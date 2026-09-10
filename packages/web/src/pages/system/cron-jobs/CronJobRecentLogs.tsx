import { useMemo } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CronJobLog, CronRunStatus } from '@zenith/shared/platform';
import { CRON_RUN_STATUSES, CRON_RUN_STATUS_OPTIONS } from '@zenith/shared/platform';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import type { UseListSearchReturn } from '@/hooks/useListSearch';
import { useCronJobAllLogs } from '@/hooks/queries/cron-jobs';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { formatDurationMs } from '@/utils/format';
import { DATE_TIME_COLUMN_WIDTH, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { compactQuery } from '@/lib/query';
import { RelativeTime, statusMeta, type RecentLogsSearchParams } from './cron-dashboard-shared';

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
  const query = useMemo(() => compactQuery({
    page,
    pageSize,
    keyword: submittedParams.keyword,
    status: submittedParams.status,
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
      title: '耗时', dataIndex: 'durationMs', width: 96, align: 'right',
      render: (v: number | null, r: CronJobLog) => (r.status === 'running' ? <span style={{ color: 'var(--semi-color-text-2)' }}>运行中</span> : formatDurationMs(v)),
    },
    dateTimeColumn('结束时间', 'endedAt'),
    {
      title: '输出', dataIndex: 'output', minWidth: 240,
      render: (v: string | null, r: CronJobLog) => (
        <span style={r.status === 'fail' ? { color: 'var(--semi-color-danger)' } : undefined}>{renderEllipsis(v)}</span>
      ),
    },
  ];

  return (
    <>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索任务名称 / 输出" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <StatusSelect items={CRON_RUN_STATUS_OPTIONS} {...bind('status', (v) => enumValueOf(CRON_RUN_STATUSES, v))} />
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

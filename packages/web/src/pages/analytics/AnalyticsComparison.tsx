/**
 * 阶段 2：对比轴选择器 + 图表下钻用户抽屉。
 *
 * 漏斗与留存共用：两处各写一份的话，「维度拆分 / 群组对比互斥」这条规则
 * 很容易在其中一处被写成可同时选择，产生后端根本不支持的请求。
 */
import { useMemo, useState } from 'react';
import { Empty, Select, SideSheet, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { AnalyticsComparison, AnalyticsBreakdownDimension, AnalyticsDrillContext } from '@zenith/shared/analytics';
import {
  ANALYTICS_BREAKDOWN_DIMENSION_OPTIONS,
  ANALYTICS_COMPARE_MAX_SEGMENTS,
} from '@zenith/shared/analytics';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { listTableProps } from '@/components/list-page';
import { useAnalyticsDrillUsers, useAnalyticsSegments } from '@/hooks/queries/analytics';
import { usePagination } from '@/hooks/usePagination';
import { dateTimeColumn } from '@/utils/table-columns';

type ComparisonMode = 'none' | 'dimension' | 'segments';

const COMPARISON_MODE_OPTIONS: Array<{ value: ComparisonMode; label: string }> = [
  { value: 'none', label: '不对比' },
  { value: 'dimension', label: '按维度拆分' },
  { value: 'segments', label: '按分群对比' },
];

export interface ComparisonPickerProps {
  value: AnalyticsComparison;
  onChange: (next: AnalyticsComparison) => void;
}

/** 对比轴选择器：模式 + 对应参数，模式切换时重置参数，避免残留上一模式的选择 */
export function ComparisonPicker({ value, onChange }: ComparisonPickerProps) {
  const segmentsQuery = useAnalyticsSegments({ page: 1, pageSize: 100, status: 'enabled' });
  const segmentOptions = useMemo(
    () => (segmentsQuery.data?.list ?? []).map((s) => ({ value: s.id, label: s.name })),
    [segmentsQuery.data?.list],
  );

  const handleMode = (mode: ComparisonMode) => {
    if (mode === 'none') onChange({ type: 'none' });
    else if (mode === 'dimension') onChange({ type: 'dimension', dimension: 'browser' });
    else onChange({ type: 'segments', segmentIds: [] });
  };

  return (
    <Space wrap>
      <Select
        value={value.type}
        optionList={COMPARISON_MODE_OPTIONS}
        onChange={(v) => handleMode(v as ComparisonMode)}
        style={{ width: 130 }}
      />
      {value.type === 'dimension' && (
        <Select
          value={value.dimension}
          optionList={ANALYTICS_BREAKDOWN_DIMENSION_OPTIONS}
          onChange={(v) => onChange({ type: 'dimension', dimension: v as AnalyticsBreakdownDimension })}
          style={{ width: 150 }}
        />
      )}
      {value.type === 'segments' && (
        <Select
          multiple
          placeholder={`选择分群（最多 ${ANALYTICS_COMPARE_MAX_SEGMENTS} 个）`}
          value={value.segmentIds}
          optionList={segmentOptions}
          loading={segmentsQuery.isFetching}
          onChange={(v) => onChange({ type: 'segments', segmentIds: ((v as number[]) ?? []).slice(0, ANALYTICS_COMPARE_MAX_SEGMENTS) })}
          style={{ minWidth: 220 }}
          maxTagCount={2}
        />
      )}
    </Space>
  );
}

/** 分群对比至少要选一个分群，否则请求体过不了 schema 校验 */
export function isComparisonReady(comparison: AnalyticsComparison): boolean {
  return comparison.type !== 'segments' || comparison.segmentIds.length > 0;
}

export interface DrillUsersSheetProps {
  /** 为 null 时抽屉关闭；非空即打开并发起查询 */
  context: AnalyticsDrillContext | null;
  title: string;
  description?: string;
  onClose: () => void;
}

/**
 * 下钻用户抽屉：把「第 N 步流失 3000 人」变成一份可核对的名单。
 * 分页与主分析解耦，翻页只改 page，不重算图表。
 */
export function DrillUsersSheet({ context, title, description, onClose }: DrillUsersSheetProps) {
  const { page, pageSize, buildPagination, resetPage } = usePagination();
  const query = useAnalyticsDrillUsers(context ? { context, page, pageSize } : null);
  const data = query.data ?? null;

  const handleClose = () => {
    resetPage();
    onClose();
  };

  return (
    <SideSheet title={title} visible={!!context} onCancel={handleClose} width={760}>
      {description && (
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 10 }}>
          {description}
        </Typography.Text>
      )}
      {data && data.matchedUsers > 0 && (
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 10 }}>
          命中 {data.matchedUsers.toLocaleString()} 人
        </Typography.Text>
      )}
      {data && data.matchedUsers === 0 && !query.isFetching ? (
        <Empty description="该位置没有命中用户" />
      ) : (
        <ConfigurableTable
          {...listTableProps(query, { pagination: buildPagination, rowKey: 'distinctId', empty: '该位置没有命中用户' })}
          columns={[
            {
              title: '用户',
              dataIndex: 'distinctId',
              render: (value: string, record) => (
                <Space spacing={4}>
                  <Typography.Text>{record.displayName || value}</Typography.Text>
                  {record.identityType === 'anonymous' && <Tag size="small" color="grey">匿名</Tag>}
                </Space>
              ),
            },
            { title: 'Distinct ID', dataIndex: 'distinctId', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
            dateTimeColumn('首次出现', 'firstSeenAt'),
            dateTimeColumn('最近活跃', 'lastSeenAt'),
          ]}
        />
      )}
    </SideSheet>
  );
}

/** 下钻抽屉的开合状态，供漏斗/留存复用 */
export function useDrillSheet() {
  const [context, setContext] = useState<AnalyticsDrillContext | null>(null);
  const [meta, setMeta] = useState<{ title: string; description?: string }>({ title: '' });
  return {
    context,
    title: meta.title,
    description: meta.description,
    open: (next: AnalyticsDrillContext, title: string, description?: string) => {
      setMeta({ title, description });
      setContext(next);
    },
    close: () => setContext(null),
  };
}

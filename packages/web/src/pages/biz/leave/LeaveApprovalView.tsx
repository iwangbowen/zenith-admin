/**
 * 请假审批查看组件（业务系统主导 external 流程的 viewComponent）
 *
 * 审批人在流程详情里看到的请假业务数据：按 bizId 从业务模块自己的接口拉取，
 * 业务数据始终留在 biz_leaves 表，流程不存储。
 */
import { Descriptions, Spin, Empty, Typography, Tag } from '@douyinfe/semi-ui';
import { CalendarClock } from 'lucide-react';
import type { WorkflowBusinessFormProps } from '@/components/workflow/BusinessFormHost';
import { useBizLeaveDetail } from '@/hooks/queries/biz-leave';

const LEAVE_TYPE_TEXT: Record<string, string> = {
  annual: '年假', sick: '病假', personal: '事假', marriage: '婚假', other: '其他',
};

export default function LeaveApprovalView({ bizId }: Readonly<WorkflowBusinessFormProps>) {
  const detailQuery = useBizLeaveDetail(bizId);
  const data = detailQuery.data ?? null;

  if (detailQuery.isFetching) return <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>;
  if (!data) return <Empty title="无法加载请假详情" style={{ padding: 24 }} />;

  return (
    <div>
      <Typography.Title heading={6} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <CalendarClock size={16} /> 请假申请
        <Tag size="small" style={{ marginLeft: 4 }}>业务系统数据</Tag>
      </Typography.Title>
      <Descriptions
        row
        data={[
          { key: '申请人', value: data.applicantName ?? '-' },
          { key: '请假类型', value: LEAVE_TYPE_TEXT[data.leaveType] ?? data.leaveType },
          { key: '开始日期', value: data.startDate },
          { key: '结束日期', value: data.endDate },
          { key: '天数', value: `${data.days} 天` },
          { key: '事由', value: data.reason || '-' },
        ]}
      />
    </div>
  );
}

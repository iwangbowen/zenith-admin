/**
 * CMS 内容审批查看组件（external 流程 viewComponent）
 *
 * 审批人在流程详情里看到的内容数据：按 bizId 从 CMS 内容接口拉取，
 * 内容数据始终留在 cms_contents 表，流程仅存路由变量。
 */
import { Descriptions, Spin, Empty, Typography, Tag } from '@douyinfe/semi-ui';
import { FileCheck } from 'lucide-react';
import type { WorkflowBusinessFormProps } from '@/components/workflow/BusinessFormHost';
import { useCmsContentDetail } from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared';

export default function ContentApprovalView({ bizId }: Readonly<WorkflowBusinessFormProps>) {
  const detailQuery = useCmsContentDetail(bizId ? Number(bizId) : undefined);
  const data = detailQuery.data ?? null;

  if (detailQuery.isFetching) return <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>;
  if (!data) return <Empty title="无法加载内容详情" style={{ padding: 24 }} />;

  return (
    <div>
      <Typography.Title heading={6} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <FileCheck size={16} /> 内容审核
        <Tag size="small" style={{ marginLeft: 4 }}>CMS 内容数据</Tag>
      </Typography.Title>
      <Descriptions
        row
        data={[
          { key: '标题', value: data.title },
          { key: '所属栏目', value: data.channelName ?? '-' },
          { key: '作者', value: data.author || '-' },
          { key: '当前状态', value: CMS_CONTENT_STATUS_LABELS[data.status] ?? data.status },
          { key: '摘要', value: data.summary || '-' },
        ]}
      />
      {data.body ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" size="small">正文预览</Typography.Text>
          <div
            style={{
              marginTop: 6,
              padding: 12,
              border: '1px solid var(--semi-color-border)',
              borderRadius: 'var(--semi-border-radius-medium)',
              maxHeight: 320,
              overflowY: 'auto',
              fontSize: 14,
            }}
            dangerouslySetInnerHTML={{ __html: data.body }}
          />
        </div>
      ) : null}
    </div>
  );
}

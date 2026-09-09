import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowInstance } from '@zenith/shared/workflow';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { dateTimeColumn } from '../../../utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { KeywordInput } from '@/components/search-filters';
import {
  workflowDefinitionNameColumn,
  workflowInitiatorColumn,
  workflowInstanceStatusColumn,
  workflowInstanceTitleColumn,
  workflowSerialNoColumn,
} from '@/components/workflow/WorkflowInstanceListColumns';
import { useWorkflowSelectableUsers } from '@/hooks/queries/workflow-shared';
import { useCcWorkflowInstances, useForwardWorkflowCc, useMarkWorkflowCcRead, workflowInstanceKeys } from '@/hooks/queries/workflow-instances';

interface SearchParams {
  keyword: string;
}

export default function CcToMePage() {
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset, applySearch } =
    useListSearch<SearchParams>({ defaults: { keyword: '' }, listKey: workflowInstanceKeys.lists });
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 转发抄送
  const [forwardTarget, setForwardTarget] = useState<WorkflowInstance | null>(null);
  const [forwardUserIds, setForwardUserIds] = useState<number[]>([]);
  const [forwardNote, setForwardNote] = useState('');
  const listQuery = useCcWorkflowInstances({ page, pageSize, keyword: submittedParams.keyword || undefined });
  const markReadMutation = useMarkWorkflowCcRead();
  const forwardMutation = useForwardWorkflowCc();
  const usersQuery = useWorkflowSelectableUsers({ enabled: forwardTarget !== null });
  const userOptions = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id })),
    [usersQuery.data],
  );

  const openDetail = (record: WorkflowInstance) => {
    setSelectedId(record.id);
    setDetailVisible(true);
    // 自动标记已读
    if (record.ccTaskId && !record.ccReadAt) {
      markReadMutation.mutate({ params: { ccTaskId: record.ccTaskId } });
    }
  };

  // 通知深链：/workflow/cc?instanceId= 自动弹出抄送详情（消费后清掉参数）
  const [urlParams, setUrlParams] = useSearchParams();
  useEffect(() => {
    const instanceId = Number(urlParams.get('instanceId'));
    if (instanceId > 0) {
      setSelectedId(instanceId);
      setDetailVisible(true);
      setUrlParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForward = (record: WorkflowInstance) => {
    setForwardTarget(record);
    setForwardUserIds([]);
    setForwardNote('');
  };

  const handleForward = async () => {
    if (!forwardTarget || forwardUserIds.length === 0) {
      Toast.warning('请选择抄送人');
      return;
    }
    await forwardMutation.mutateAsync({ params: { id: forwardTarget.id }, body: { userIds: forwardUserIds, note: forwardNote || undefined } });
    Toast.success('已抄送');
    setForwardTarget(null);
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    workflowInstanceTitleColumn<WorkflowInstance>(),
    workflowSerialNoColumn<WorkflowInstance>(),
    workflowDefinitionNameColumn<WorkflowInstance>(),
    workflowInitiatorColumn<WorkflowInstance>(),
    dateTimeColumn('抄送时间', 'ccDeliveredAt'),
    {
      title: '阅读',
      dataIndex: 'ccReadAt',
      width: 80,
      render: (v: string | null) => (v ? <Tag color="grey" size="small">已读</Tag> : <Tag color="red" size="small">未读</Tag>),
    },
    workflowInstanceStatusColumn<WorkflowInstance>(),
    createOperationColumn<WorkflowInstance>({
      width: 150,
      desktopInlineKeys: ['detail', 'forward'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => openDetail(record) },
        { key: 'forward', label: '转发', onClick: () => openForward(record) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SavedViewsBar
        pageKey="workflow-cc"
        currentFilters={{ keyword: submittedParams.keyword }}
        onApply={(filters) => applySearch({ keyword: typeof filters.keyword === 'string' ? filters.keyword : '' })}
      />
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索标题 / 流程名称" value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      <ConfigurableTable<WorkflowInstance>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />
      <WorkflowInstanceDetailSheet
        instanceId={selectedId}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        title="抄送详情"
      />
      <AppModal
        title="转发抄送"
        visible={forwardTarget !== null}
        onCancel={() => setForwardTarget(null)}
        onOk={() => void handleForward()}
        confirmLoading={forwardMutation.isPending}
        okText="确定转发"
        closeOnEsc
      >
        <Typography.Text type="tertiary" size="small">将该流程抄送给指定成员（自动去重，已抄送的成员会被跳过）。</Typography.Text>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>抄送人</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            multiple
            filter
            value={forwardUserIds}
            onChange={(v) => setForwardUserIds(v as number[])}
            optionList={userOptions}
            placeholder="请选择抄送人"
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>备注</Typography.Text>
          <Input
            style={{ marginTop: 4 }}
            value={forwardNote}
            onChange={setForwardNote}
            placeholder="可选，最多 256 字"
            maxLength={256}
          />
        </div>
      </AppModal>
    </div>
  );
}

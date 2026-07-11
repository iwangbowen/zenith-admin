import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowInstance } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { KeywordSearchToolbar } from '@/components/KeywordSearchToolbar';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useAllUsers } from '@/hooks/queries/users';
import { useCcWorkflowInstances, useForwardWorkflowCc, useMarkWorkflowCcRead, workflowInstanceKeys } from '@/hooks/queries/workflow-instances';

export default function CcToMePage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 转发抄送
  const [forwardTarget, setForwardTarget] = useState<WorkflowInstance | null>(null);
  const [forwardUserIds, setForwardUserIds] = useState<number[]>([]);
  const [forwardNote, setForwardNote] = useState('');
  const listQuery = useCcWorkflowInstances({ page, pageSize, keyword: submittedKeyword || undefined });
  const data = listQuery.data;
  const markReadMutation = useMarkWorkflowCcRead();
  const forwardMutation = useForwardWorkflowCc();
  const usersQuery = useAllUsers({ enabled: forwardTarget !== null });
  const userOptions = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id })),
    [usersQuery.data],
  );

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
  };

  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
  };

  const openDetail = (record: WorkflowInstance) => {
    setSelectedId(record.id);
    setDetailVisible(true);
    // 自动标记已读
    if (record.ccTaskId && !record.ccReadAt) {
      markReadMutation.mutate(record.ccTaskId);
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
    await forwardMutation.mutateAsync({ id: forwardTarget.id, userIds: forwardUserIds, note: forwardNote || undefined });
    Toast.success('已抄送');
    setForwardTarget(null);
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    { title: '申请标题', dataIndex: 'title', width: 200, render: renderEllipsis },
    { title: '业务编号', dataIndex: 'serialNo', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '流程名称', dataIndex: 'definitionName', width: 160, render: renderEllipsis },
    { title: '发起人', dataIndex: 'initiatorName', width: 120, render: (v: string | null) => v ?? '—' },
    { title: '抄送时间', dataIndex: 'createdAt', width: 170, render: (v: string) => formatDateTime(v) },
    {
      title: '阅读',
      dataIndex: 'ccReadAt',
      width: 80,
      render: (v: string | null) => (v ? <Tag color="grey" size="small">已读</Tag> : <Tag color="red" size="small">未读</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (v: string) => {
        const s = INSTANCE_STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    createOperationColumn<WorkflowInstance>({
      width: 140,
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
        currentFilters={{ keyword: submittedKeyword }}
        onApply={(filters) => {
          const keyword = typeof filters.keyword === 'string' ? filters.keyword : '';
          setDraftKeyword(keyword);
          setSubmittedKeyword(keyword);
          setPage(1);
          void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
        }}
      />
      <KeywordSearchToolbar
        placeholder="搜索标题 / 流程名称"
        value={draftKeyword}
        onChange={setDraftKeyword}
        onSearch={handleSearch}
        onReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
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

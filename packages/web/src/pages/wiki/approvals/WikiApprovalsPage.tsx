import { useState } from 'react';
import { Button, Modal, Space, Tabs, Tag, TextArea, Timeline, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Check, X } from 'lucide-react';
import type { WikiDoc, WikiReviewRecord } from '@zenith/shared/wiki';
import { WIKI_DOC_STATUS_LABELS, WIKI_REVIEW_ACTION_LABELS } from '@zenith/shared/wiki';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { KeywordInput } from '@/components/search-filters';
import AppModal from '@/components/AppModal';
import MarkdownPreviewPanel from '@/components/MarkdownPreviewPanel';
import { renderEllipsis, updatedAtColumn, dateTimeColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  useMyProcessedReviews, useReviewWikiDoc, useWikiDocDetail, useWikiDocList,
  useWikiDocReviewRecords, useWithdrawWikiDoc, wikiDocKeys,
} from '@/hooks/queries/wiki-docs';

const { Text } = Typography;

interface SearchParams {
  keyword: string;
}

const defaultSearchParams: SearchParams = { keyword: '' };

const ACTION_TAG_COLOR: Record<WikiReviewRecord['action'], 'blue' | 'green' | 'red' | 'grey'> = {
  submit: 'blue',
  approve: 'green',
  reject: 'red',
  withdraw: 'grey',
};

const STATUS_TAG_COLOR: Record<string, 'grey' | 'orange' | 'green' | 'red'> = {
  draft: 'grey',
  pending: 'orange',
  published: 'green',
  rejected: 'red',
};

/** 待审核 Tab */
function PendingPane() {
  const { hasPermission } = usePermission();
  const canReview = hasPermission('wiki:approval:review');

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: wikiDocKeys.lists });

  const listQuery = useWikiDocList({
    page,
    pageSize,
    status: 'pending',
    keyword: submittedParams.keyword || undefined,
  });

  const reviewMutation = useReviewWikiDoc();
  const [previewId, setPreviewId] = useState<number>();
  const previewQuery = useWikiDocDetail(previewId);
  const [rejectTarget, setRejectTarget] = useState<WikiDoc | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  function handleApprove(record: WikiDoc) {
    Modal.confirm({
      title: `确认通过「${record.title}」并发布？`,
      content: '发布后，所有可访问该空间的成员将立即看到当前版本。',
      okText: '通过并发布',
      onOk: async () => {
        await reviewMutation.mutateAsync({ params: { id: record.id }, body: { action: 'approve' } });
        Toast.success('已通过并发布');
        setPreviewId(undefined);
      },
    });
  }

  function handleReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Toast.warning('请填写驳回意见');
      return;
    }
    reviewMutation.mutate(
      { params: { id: rejectTarget.id }, body: { action: 'reject', reason } },
      {
        onSuccess: () => {
          Toast.success('已驳回');
          setRejectTarget(null);
          setRejectReason('');
          setPreviewId(undefined);
        },
      },
    );
  }

  const columns: ColumnProps<WikiDoc>[] = [
    { title: '标题', dataIndex: 'title', minWidth: 240, render: renderEllipsis },
    { title: '所属空间', dataIndex: 'spaceName', width: 140, render: renderEllipsis },
    { title: '作者', dataIndex: 'authorName', width: 120, render: (v: string | null) => v ?? '—' },
    { title: '版本', dataIndex: 'currentVersion', width: 80, render: (v: number) => `v${v}` },
    updatedAtColumn,
    createOperationColumn<WikiDoc>({
      width: 210,
      desktopInlineKeys: ['preview', 'approve', 'reject'],
      actions: (record) => [
        { key: 'preview', label: '预览', onClick: () => setPreviewId(record.id) },
        ...(canReview ? [{
          key: 'approve', label: '通过',
          onClick: () => handleApprove(record),
        }, {
          key: 'reject', label: '驳回', danger: true,
          onClick: () => { setRejectTarget(record); setRejectReason(''); },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索标题..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  return (
    <>
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      <ConfigurableTable<WikiDoc>
        columns={columns}
        empty="没有待审核的文档"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal
        title={previewQuery.data?.title ?? '文档预览'}
        visible={previewId !== undefined}
        closeOnEsc
        width={860}
        onCancel={() => setPreviewId(undefined)}
        footer={canReview && previewQuery.data ? (
          <Space spacing={8}>
            <Button
              icon={<X size={14} />}
              type="danger"
              onClick={() => { setRejectTarget(previewQuery.data!); setRejectReason(''); }}
            >
              驳回
            </Button>
            <Button
              theme="solid"
              icon={<Check size={14} />}
              loading={reviewMutation.isPending}
              onClick={() => handleApprove(previewQuery.data!)}
            >
              通过并发布
            </Button>
          </Space>
        ) : null}
      >
        <div style={{ height: '60vh', overflow: 'hidden', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
          <MarkdownPreviewPanel content={previewQuery.data?.content ?? ''} />
        </div>
      </AppModal>

      <AppModal
        title={`驳回「${rejectTarget?.title ?? ''}」`}
        visible={!!rejectTarget}
        closeOnEsc
        width={480}
        onCancel={() => setRejectTarget(null)}
        onOk={handleReject}
        okText="确认驳回"
        okButtonProps={{ type: 'danger', loading: reviewMutation.isPending }}
      >
        <Text type="tertiary">驳回后文档将标记为「已驳回」，作者可修改后重新提交。</Text>
        <TextArea
          style={{ marginTop: 12 }}
          value={rejectReason}
          onChange={setRejectReason}
          placeholder="请填写驳回意见（必填）"
          rows={4}
          maxCount={500}
        />
      </AppModal>
    </>
  );
}

/** 我提交的 Tab：完整提交历史，支持撤回待审文档与查看时间线 */
function MySubmissionsPane() {
  const { page, pageSize, buildPagination } = usePagination();
  const listQuery = useWikiDocList({ page, pageSize, submitted: true });

  const withdrawMutation = useWithdrawWikiDoc();
  const [timelineDocId, setTimelineDocId] = useState<number>();
  const timelineQuery = useWikiDocReviewRecords(timelineDocId, timelineDocId !== undefined);

  const columns: ColumnProps<WikiDoc>[] = [
    { title: '标题', dataIndex: 'title', minWidth: 240, render: renderEllipsis },
    { title: '所属空间', dataIndex: 'spaceName', width: 140, render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: WikiDoc['status']) => <Tag color={STATUS_TAG_COLOR[v]}>{WIKI_DOC_STATUS_LABELS[v]}</Tag>,
    },
    { title: '驳回意见', dataIndex: 'rejectReason', width: 220, render: renderEllipsis },
    updatedAtColumn,
    createOperationColumn<WikiDoc>({
      width: 180,
      desktopInlineKeys: ['timeline', 'withdraw'],
      actions: (record) => [
        { key: 'timeline', label: '审核记录', onClick: () => setTimelineDocId(record.id) },
        ...(record.status === 'pending' ? [{
          key: 'withdraw', label: '撤回',
          onClick: () => withdrawMutation.mutate({ params: { id: record.id } }, { onSuccess: () => Toast.success('已撤回，可继续编辑') }),
        }] : []),
      ],
    }),
  ];

  return (
    <>
      <ConfigurableTable<WikiDoc>
        columns={columns}
        empty="还没有提交过文档审核"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal
        title="审核记录"
        visible={timelineDocId !== undefined}
        closeOnEsc
        width={520}
        footer={null}
        onCancel={() => setTimelineDocId(undefined)}
      >
        <Timeline>
          {(timelineQuery.data ?? []).map((r) => (
            <Timeline.Item
              key={r.id}
              time={r.createdAt}
              type={r.action === 'approve' ? 'success' : r.action === 'reject' ? 'error' : 'default'}
            >
              <Space spacing={8}>
                <Tag size="small" color={ACTION_TAG_COLOR[r.action]}>{WIKI_REVIEW_ACTION_LABELS[r.action]}</Tag>
                <Text>{r.actorName ?? '—'}</Text>
                <Text type="tertiary" size="small">v{r.version}</Text>
              </Space>
              {r.reason ? <div><Text type="tertiary" size="small">{r.reason}</Text></div> : null}
            </Timeline.Item>
          ))}
        </Timeline>
        {timelineQuery.data?.length === 0 ? <Text type="tertiary">暂无审核记录</Text> : null}
      </AppModal>
    </>
  );
}

/** 已处理 Tab：我通过 / 驳回过的记录 */
function ProcessedPane() {
  const { page, pageSize, buildPagination } = usePagination();
  const listQuery = useMyProcessedReviews({ page, pageSize });

  const columns: ColumnProps<WikiReviewRecord>[] = [
    { title: '文档标题', dataIndex: 'docTitle', width: 260, render: renderEllipsis },
    {
      title: '处理结果', dataIndex: 'action', width: 110,
      render: (v: WikiReviewRecord['action']) => <Tag color={ACTION_TAG_COLOR[v]}>{WIKI_REVIEW_ACTION_LABELS[v]}</Tag>,
    },
    { title: '版本', dataIndex: 'version', width: 80, render: (v: number) => `v${v}` },
    { title: '意见', dataIndex: 'reason', width: 240, render: renderEllipsis },
    dateTimeColumn('处理时间', 'createdAt'),
  ];

  return (
    <ConfigurableTable<WikiReviewRecord>
      columns={columns}
      empty="还没有处理过审核"
      {...listTableProps(listQuery, { pagination: buildPagination })}
    />
  );
}

export default function WikiApprovalsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['pending', 'mine', 'processed'] as const, 'pending');
  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <Tabs.TabPane tab="待审核" itemKey="pending">
          <PendingPane />
        </Tabs.TabPane>
        <Tabs.TabPane tab="我提交的" itemKey="mine">
          <MySubmissionsPane />
        </Tabs.TabPane>
        <Tabs.TabPane tab="已处理" itemKey="processed">
          <ProcessedPane />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}

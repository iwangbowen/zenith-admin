import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, SideSheet, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CMS_INTERACTION_KIND_LABELS, CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS, CMS_INTERACTION_QUESTION_TYPE_LABELS, CMS_INTERACTION_REPEAT_POLICY_LABELS, CMS_INTERACTION_STATUS_LABELS, CMS_INTERACTION_KIND_OPTIONS, CMS_INTERACTION_STATUS_OPTIONS } from '@zenith/shared/cms';
import type { CmsInteraction, CmsInteractionKind, CmsInteractionResponse, CmsInteractionStatus } from '@zenith/shared/cms';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  cmsInteractionKeys,
  useBatchCmsInteractionStatus,
  useAllCmsSites,
  useCmsInteractionList,
  useCmsInteractionOptions,
  useCmsInteractionResponseList,
  useCopyCmsInteraction,
  useDeleteCmsInteraction,
  useSetCmsInteractionStatus,
} from '@/hooks/queries/cms';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';
import InteractionResultsSheet from './interaction/InteractionResultsSheet';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

import { useUrlTabState } from '@/hooks/useUrlTabState';
interface ListSearch {
  keyword: string;
  kind?: CmsInteractionKind;
  status?: CmsInteractionStatus;
}

const initialSearch: ListSearch = { keyword: '' };
const STATUS_COLORS: Record<CmsInteractionStatus, 'grey' | 'green' | 'orange'> = {
  draft: 'grey',
  published: 'green',
  closed: 'orange',
};

export default function SurveysPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['interactions', 'responses'] as const, 'interactions');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [draft, setDraft] = useState<ListSearch>(initialSearch);
  const [submitted, setSubmitted] = useState<ListSearch>(initialSearch);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [resultsTarget, setResultsTarget] = useState<CmsInteraction | null>(null);
  const [responseDetail, setResponseDetail] = useState<CmsInteractionResponse | null>(null);
  const [responsePage, setResponsePage] = useState(1);
  const [responseTimeRange, setResponseTimeRange] = useState<[Date, Date] | undefined>();
  const [responseInteractionId, setResponseInteractionId] = useState<number | undefined>();

  const listQuery = useCmsInteractionList({
    page,
    pageSize,
    siteId: siteId ?? 0,
    keyword: submitted.keyword || undefined,
    kind: submitted.kind,
    status: submitted.status,
  }, !!siteId);
  const sitesQuery = useAllCmsSites();
  const currentSite = sitesQuery.data?.find((site) => site.id === siteId);
  const deleteMutation = useDeleteCmsInteraction();
  const copyMutation = useCopyCmsInteraction();
  const statusMutation = useSetCmsInteractionStatus();
  const batchMutation = useBatchCmsInteractionStatus();
  const interactionOptionsQuery = useCmsInteractionOptions(siteId);
  const responseQuery = useCmsInteractionResponseList({
    page: responsePage,
    pageSize,
    siteId: siteId ?? 0,
    interactionId: responseInteractionId,
    kind: submitted.kind,
    ...formatDateTimeRangeForApi(responseTimeRange),
  }, !!siteId);

  const canManage = hasPermission('cms:interaction:manage');
  const canBatch = hasPermission('cms:interaction:batch');

  const handleSearch = () => {
    setPage(1);
    setResponsePage(1);
    setSelectedIds([]);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setResponsePage(1);
    setDraft(initialSearch);
    setSubmitted(initialSearch);
    setResponseTimeRange(undefined);
    setResponseInteractionId(undefined);
    setSelectedIds([]);
    void queryClient.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
  };

  const openEditor = (record: CmsInteraction) => {
    navigate(`/cms/interactions/edit?id=${record.id}&siteId=${record.siteId}`);
  };

  const openCreate = () => {
    navigate(`/cms/interactions/edit?siteId=${siteId}`);
  };

  const changeStatus = async (record: CmsInteraction, status: CmsInteractionStatus) => {
    await statusMutation.mutateAsync({ params: { id: record.id }, body: { status } });
    Toast.success(status === 'published' ? '已发布' : status === 'closed' ? '已关闭' : '已转为草稿');
  };

  const submitBatch = (status: 'published' | 'closed') => {
    Modal.confirm({
      title: status === 'published' ? '批量发布互动问卷？' : '批量关闭互动问卷？',
      content: '操作将提交到任务中心，可在全局任务托盘查看进度、取消或重试。',
      onOk: async () => {
        await batchMutation.mutateAsync({ body: { ids: selectedIds, status } });
        setSelectedIds([]);
        Toast.success('批量任务已提交');
      },
    });
  };

  const listColumns: ColumnProps<CmsInteraction>[] = [
    { title: '标题', dataIndex: 'title', minWidth: 240, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'kind', width: 90,
      render: (value: CmsInteractionKind) => <Tag size="small">{CMS_INTERACTION_KIND_LABELS[value]}</Tag>,
    },
    { title: '标识', dataIndex: 'code', width: 150 },
    { title: '参与范围', dataIndex: 'participantScope', width: 120, render: (value: CmsInteraction['participantScope']) => CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS[value] },
    { title: '重复策略', dataIndex: 'repeatPolicy', width: 140, render: (value: CmsInteraction['repeatPolicy']) => CMS_INTERACTION_REPEAT_POLICY_LABELS[value] },
    { title: '答卷数', dataIndex: 'responseCount', width: 90, align: 'right' },
    dateTimeColumn('创建时间', 'createdAt'),
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (value: CmsInteractionStatus) => <Tag size="small" color={STATUS_COLORS[value]}>{CMS_INTERACTION_STATUS_LABELS[value]}</Tag>,
    },
    createOperationColumn<CmsInteraction>({
      width: 240,
      desktopInlineKeys: ['results', 'publish', 'close', 'edit'],
      actions: (record) => [
        { key: 'results', label: '结果', onClick: () => setResultsTarget(record) },
        {
          key: 'visit',
          label: '访问',
          hidden: record.status === 'draft' || !currentSite,
          onClick: () => {
            if (currentSite) window.open(cmsPreviewUrl(currentSite.code, `interaction/${record.code}/`), '_blank');
          },
        },
        {
          key: 'publish', label: '发布',
          hidden: !canManage || record.status === 'published',
          onClick: () => { void changeStatus(record, 'published'); },
        },
        {
          key: 'close', label: '关闭',
          hidden: !canManage || record.status !== 'published',
          onClick: () => { void changeStatus(record, 'closed'); },
        },
        {
          key: 'edit', label: '设计', hidden: !canManage,
          onClick: () => openEditor(record),
        },
        {
          key: 'copy', label: '复制', hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: `复制「${record.title}」？`,
              content: '将生成一份草稿副本（配置与题目全量复制，答卷不复制），可直接修改题目。',
              onOk: async () => {
                const created = await copyMutation.mutateAsync({ params: { id: record.id } });
                Toast.success(`已生成副本「${created.title}」`);
                openEditor(created);
              },
            });
          },
        },
        {
          key: 'delete', label: '删除', danger: true,
          hidden: !canManage,
          onClick: () => {
            confirmDelete({
              title: `删除「${record.title}」？`,
              content: `将级联删除 ${record.responseCount} 份答卷，无法恢复。`,
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        },
      ],
    }),
  ];

  const responseColumns: ColumnProps<CmsInteractionResponse>[] = [
    { title: '互动问卷', dataIndex: 'interactionTitle', width: 240, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'kind', width: 90,
      render: (value: CmsInteractionKind | undefined) => value ? CMS_INTERACTION_KIND_LABELS[value] : '-',
    },
    { title: '参与者', dataIndex: 'memberDisplay', width: 140 },
    {
      title: '作答摘要', dataIndex: 'answerDetails', minWidth: 320,
      render: (details: CmsInteractionResponse['answerDetails']) =>
        renderEllipsis(details.map((detail) => `${detail.label}：${detail.display}`).join('；') || '-'),
    },
    dateTimeColumn('提交时间', 'createdAt'),
    createOperationColumn<CmsInteractionResponse>({
      width: 100,
      desktopInlineKeys: ['view'],
      actions: (record) => [{ key: 'view', label: '查看', onClick: () => setResponseDetail(record) }],
    }),
  ];

  const listSearch = (
    <>
      <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); setResponsePage(1); setSelectedIds([]); setResponseInteractionId(undefined); }} />
      <KeywordInput placeholder="标题/标识" value={draft.keyword} onChange={(value) => setDraft((current) => ({ ...current, keyword: value }))} onSearch={handleSearch} width={200} />
      <FilterSelect
        placeholder="全部类型"
        items={CMS_INTERACTION_KIND_OPTIONS}
        value={draft.kind}
        onChange={(value) => { setDraft((current) => ({ ...current, kind: value as CmsInteractionKind | undefined })); setSelectedIds([]); }}
      />
      <StatusSelect items={CMS_INTERACTION_STATUS_OPTIONS} value={draft.status}
        onChange={(value) => { setDraft((current) => ({ ...current, status: value as CmsInteractionStatus | undefined })); setSelectedIds([]); }} />
      <SearchButton onClick={handleSearch} />
      <ResetButton onClick={handleReset} />
    </>
  );

  const responseExportQuery = {
    siteId,
    interactionId: responseInteractionId,
    kind: submitted.kind,
    ...formatDateTimeRangeForApi(responseTimeRange),
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" lazyRender keepDOM={false} activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <TabPane tab="互动管理" itemKey="interactions">
          <SearchToolbar
            primary={listSearch}
            actions={canManage && siteId ? <CreateButton onClick={openCreate} /> : null}
            mobilePrimary={(
              <>
                <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); setResponsePage(1); setSelectedIds([]); setResponseInteractionId(undefined); }} />
                <SearchButton onClick={handleSearch} />
                {canManage ? <CreateButton onClick={openCreate} /> : null}
              </>
            )}
            mobileFilters={listSearch}
            filterTitle="互动问卷筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          {selectedIds.length > 0 && canBatch ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <Button onClick={() => submitBatch('published')}>批量发布（{selectedIds.length}）</Button>
              <Button type="warning" onClick={() => submitBatch('closed')}>批量关闭</Button>
            </div>
          ) : null}
          <ConfigurableTable
            bordered
            columns={listColumns}
            dataSource={listQuery.data?.list ?? []}
            loading={listQuery.isFetching}
            rowKey={(record) => String(record?.id ?? '')}
            empty={siteId ? '暂无互动问卷' : '请先选择站点'}
            rowSelection={{ selectedRowKeys: selectedIds.map(String), onChange: (keys) => setSelectedIds((keys ?? []).map(Number)) }}
            onRefresh={() => void listQuery.refetch()}
            refreshLoading={listQuery.isFetching}
            pagination={buildPagination(listQuery.data?.total ?? 0, () => setSelectedIds([]))}
          />
        </TabPane>
        <TabPane tab="答卷明细" itemKey="responses">
          <SearchToolbar
            primary={(
              <>
                <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); setResponsePage(1); setSelectedIds([]); setResponseInteractionId(undefined); }} />
                <FilterSelect
                  placeholder="全部互动问卷"
                  items={(interactionOptionsQuery.data ?? []).map((item) => ({ value: item.id, label: item.title }))}
                  value={responseInteractionId}
                  onChange={(value) => { setResponseInteractionId(value as number | undefined); setResponsePage(1); }}
                  width={200}
                  filter
                  loading={interactionOptionsQuery.isFetching}
                />
                <FilterSelect
                  placeholder="全部类型"
                  items={CMS_INTERACTION_KIND_OPTIONS}
                  value={draft.kind}
                  onChange={(value) => setDraft((current) => ({ ...current, kind: value as CmsInteractionKind | undefined }))}
                  width={140}
                />
                <DateRangeFilter placeholder={['提交开始时间', '提交结束时间']} value={responseTimeRange} onChange={(value) => setResponseTimeRange(value as [Date, Date] | undefined)} width={330} />
                <SearchButton onClick={handleSearch} />
                <ResetButton onClick={handleReset} />
              </>
            )}
            actions={siteId && hasPermission('cms:interaction:export')
              ? <ExportButton entity="cms.interaction-responses" permission="cms:interaction:export" query={responseExportQuery} />
              : null}
          />
          <ConfigurableTable
            bordered
            columns={responseColumns}
            dataSource={responseQuery.data?.list ?? []}
            loading={responseQuery.isFetching}
            rowKey={(record) => String(record?.id ?? '')}
            empty={siteId ? '暂无答卷' : '请先选择站点'}
            onRefresh={() => void responseQuery.refetch()}
            refreshLoading={responseQuery.isFetching}
            pagination={{
              total: responseQuery.data?.total ?? 0,
              pageSize,
              currentPage: responsePage,
              onPageChange: setResponsePage,
            }}
          />
        </TabPane>
      </Tabs>

      <InteractionResultsSheet interaction={resultsTarget} onClose={() => setResultsTarget(null)} />      <SideSheet title="答卷详情" visible={!!responseDetail} onCancel={() => setResponseDetail(null)} width={520}>
        {responseDetail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <dl style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10, margin: 0 }}>
              <dt>互动问卷</dt><dd style={{ margin: 0 }}>{responseDetail.interactionTitle}</dd>
              <dt>参与者</dt><dd style={{ margin: 0 }}>{responseDetail.memberDisplay}</dd>
              <dt>提交时间</dt><dd style={{ margin: 0 }}>{responseDetail.createdAt}</dd>
            </dl>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Typography.Title heading={6}>作答内容</Typography.Title>
              {responseDetail.answerDetails.length === 0 ? (
                <Typography.Text type="tertiary">该答卷没有作答记录（题目可能已被删除）</Typography.Text>
              ) : responseDetail.answerDetails.map((detail, index) => (
                <section key={detail.questionId}>
                  <Typography.Text strong>
                    {index + 1}. {detail.label}
                    <Tag size="small" style={{ marginLeft: 8 }}>{CMS_INTERACTION_QUESTION_TYPE_LABELS[detail.type]}</Tag>
                  </Typography.Text>
                  <div style={{
                    marginTop: 6,
                    padding: '8px 10px',
                    background: 'var(--semi-color-fill-0)',
                    borderRadius: 'var(--semi-border-radius-medium)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {detail.display || <Typography.Text type="tertiary">未作答</Typography.Text>}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </SideSheet>
    </div>
  );
}

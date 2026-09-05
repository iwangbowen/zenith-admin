import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Descriptions, Form, Modal, SideSheet, Space, Spin, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ClipboardPlus, ExternalLink } from 'lucide-react';
import { REPORT_FILL_RECORD_STATUS_LABELS, REPORT_FILL_RECORD_STATUS_OPTIONS, REPORT_FILL_SYNC_STATUS_LABELS } from '@zenith/shared/report';
import type { ReportFillRecord, ReportFillRecordStatus } from '@zenith/shared/report';
import type { AsyncTask } from '@zenith/shared/tasks';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import AppModal from '@/components/AppModal';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { useAllUsers } from '@/hooks/queries/users';
import {
  reportFillKeys,
  useReportFillRecordAdmin,
  useReportFillRecordDetail,
  useReportFillRecordMine,
  useReportFillTemplateLookup,
  useReviewReportFillRecord,
  useWithdrawReportFillRecord,
} from '@/hooks/queries/report-fill';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@/utils/date';
import { canRunFillRecordAction, isRevisionConflict, shouldShowFillReviewTab } from './report-p2-utils';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';

import { useUrlTabState } from '@/hooks/useUrlTabState';
interface MineFilters {
  keyword: string;
  status?: ReportFillRecordStatus;
  templateId?: number;
}

interface AdminFilters {
  status?: ReportFillRecordStatus;
  templateId?: number;
  submitterId?: number;
}

const DEFAULT_MINE: MineFilters = { keyword: '' };
const DEFAULT_ADMIN: AdminFilters = {};

function recordStatusTag(status: ReportFillRecordStatus) {
  const color = status === 'approved'
    ? 'green'
    : status === 'rejected'
      ? 'red'
      : status === 'submitted' || status === 'in_review'
        ? 'blue'
        : status === 'cancelled'
          ? 'grey'
          : 'amber';
  return <Tag size="small" color={color}>{REPORT_FILL_RECORD_STATUS_LABELS[status]}</Tag>;
}

function syncStatus(record: ReportFillRecord, task?: AsyncTask) {
  if (task && (task.status === 'pending' || task.status === 'running')) {
    return <AsyncTaskProgress task={task} />;
  }
  const color = record.syncStatus === 'succeeded' ? 'green' : record.syncStatus === 'failed' ? 'red' : 'grey';
  return <Tag size="small" color={color}>{REPORT_FILL_SYNC_STATUS_LABELS[record.syncStatus]}</Tag>;
}

export default function FillRecordsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('report:fill:record:create');
  const canReview = shouldShowFillReviewTab(hasPermission('report:fill:record:review'));
  const [activeTab, setActiveTab] = useUrlTabState(['mine', 'admin'] as const, 'mine');
  const minePagination = usePagination();
  const adminPagination = usePagination();
  const [mineDraft, setMineDraft] = useState<MineFilters>(DEFAULT_MINE);
  const [mineSubmitted, setMineSubmitted] = useState<MineFilters>(DEFAULT_MINE);
  const [adminDraft, setAdminDraft] = useState<AdminFilters>(DEFAULT_ADMIN);
  const [adminSubmitted, setAdminSubmitted] = useState<AdminFilters>(DEFAULT_ADMIN);
  const [detailId, setDetailId] = useState<number>();
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved');
  const [entryVisible, setEntryVisible] = useState(false);
  const entryFormApi = useRef<FormApi | null>(null);

  const templateLookupQuery = useReportFillTemplateLookup(canCreate);
  const templates = templateLookupQuery.data ?? [];
  const users = useAllUsers({ enabled: canReview }).data ?? [];
  const mineQuery = useReportFillRecordMine({
    page: minePagination.page,
    pageSize: minePagination.pageSize,
    keyword: mineSubmitted.keyword || undefined,
    status: mineSubmitted.status,
    templateId: mineSubmitted.templateId,
  });
  const adminQuery = useReportFillRecordAdmin({
    page: adminPagination.page,
    pageSize: adminPagination.pageSize,
    status: adminSubmitted.status,
    templateId: adminSubmitted.templateId,
    submitterId: adminSubmitted.submitterId,
  }, canReview);
  const detailQuery = useReportFillRecordDetail(detailId);
  const { tasks: fillTasks } = useMyAsyncTasks({ taskTypes: ['report-fill-sync'], pageSize: 100 });
  const reviewMutation = useReviewReportFillRecord();
  const withdrawMutation = useWithdrawReportFillRecord();
  const taskMap = useMemo(() => new Map(fillTasks.map((task) => [task.id, task])), [fillTasks]);

  function findTemplate(record: ReportFillRecord) {
    return templates.find((template) => template.id === record.templateId);
  }

  function openEntry(record?: ReportFillRecord) {
    if (!record) {
      setEntryVisible(true);
      return;
    }
    const template = findTemplate(record);
    const entryCode = template?.code ?? `record-${record.templateId}`;
    navigate(`/report/fill/${encodeURIComponent(entryCode)}?recordId=${record.id}`, {
      state: { tabTitle: `填报·${template?.name ?? record.templateName ?? entryCode}` },
    });
  }

  async function handleWithdraw(record: ReportFillRecord) {
    try {
      await withdrawMutation.mutateAsync({
        params: { id: record.id },
        body: { expectedRevision: record.revision, reason: '用户主动撤回' },
      });
      Toast.success(record.status === 'draft' ? '草稿已取消' : '填报已撤回');
    } catch (error) {
      if (isRevisionConflict(error)) {
        Modal.warning({
          title: '记录状态已变化',
          content: '请刷新列表后确认最新状态。',
          onOk: () => void mineQuery.refetch(),
        });
        return;
      }
      throw error;
    }
  }

  const reviewSave = {
    isPending: reviewMutation.isPending,
    mutateAsync: async (vars: { id?: number; values: { decision: typeof reviewDecision; expectedRevision: number; comment?: string } }) => {
      try {
        return await reviewMutation.mutateAsync({ params: { id: vars.id ?? 0 }, body: vars.values });
      } catch (error) {
        if (isRevisionConflict(error)) {
          Modal.warning({
            title: '审核冲突',
            content: '该记录已被其他审核人处理，请刷新最新状态。',
            onOk: () => {
              reviewModal.close();
              void adminQuery.refetch();
            },
          });
        }
        throw error;
      }
    },
  };
  const reviewModal = useEditModal<ReportFillRecord, { comment?: string }, { decision: typeof reviewDecision; expectedRevision: number; comment?: string }>({
    save: reviewSave,
    beforeSave: (values, { editing }) => ({
      decision: reviewDecision,
      expectedRevision: editing?.revision ?? 0,
      comment: values.comment?.trim() || undefined,
    }),
    successMessage: () => reviewDecision === 'approved' ? '审核已通过' : '记录已拒绝',
    onSaved: (_saved, { editing }) => {
      if (detailId === editing?.id) void detailQuery.refetch();
    },
  });

  const createColumns = (admin: boolean): ColumnProps<ReportFillRecord>[] => [
    { title: '记录号', dataIndex: 'id', width: 90, render: (value: number) => `#${value}` },
    { title: '模板', dataIndex: 'templateName', minWidth: 180, render: (value: string | null, record) => renderEllipsis(value || `模板 #${record.templateId}`) },
    ...(admin ? [{
      title: '提交人',
      dataIndex: 'submitterName',
      width: 120,
      render: (value: string | null, record: ReportFillRecord) => value || `用户 #${record.submitterId}`,
    } satisfies ColumnProps<ReportFillRecord>] : []),
    { title: '模板版本', dataIndex: 'templateRevision', width: 90 },
    {
      title: '工作流',
      dataIndex: 'workflowInstanceId',
      width: 120,
      render: (value: number | null) => value ? (
        <Button
          theme="borderless"
          size="small"
          icon={<ExternalLink size={13} />}
          onClick={() => navigate(`/workflow/instance/${value}`)}
        >
          #{value}
        </Button>
      ) : '—',
    },
    {
      title: '消费同步',
      dataIndex: 'syncStatus',
      width: 150,
      render: (_value: string, record) => syncStatus(
        record,
        record.syncTaskId ? taskMap.get(record.syncTaskId) : undefined,
      ),
    },
    {
      title: '消费数据集',
      dataIndex: 'generatedDatasetId',
      width: 120,
      render: (value: number | null, record) => record.status === 'approved' && value ? (
        <Button theme="borderless" size="small" onClick={() => navigate(`/report/datasets?resourceId=${value}`)}>
          数据集 #{value}
        </Button>
      ) : '—',
    },
    dateTimeColumn('提交时间', 'submittedAt'),
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: ReportFillRecordStatus) => recordStatusTag(value),
    },
    createOperationColumn<ReportFillRecord>({
      // 审核管理：详情 / 审核；我的填报：详情 / 编辑（被驳回时为「修改重提」）+ 更多
      width: admin ? 150 : 210,
      desktopInlineKeys: admin ? ['detail', 'review'] : ['detail', 'edit'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setDetailId(record.id) },
        ...(!admin ? [{
          key: 'edit',
          label: record.status === 'rejected' ? '修改重提' : '编辑',
          hidden: !hasPermission('report:fill:record:update') || !canRunFillRecordAction(record, 'edit'),
          onClick: () => openEntry(record),
        }, {
          key: 'withdraw',
          label: record.status === 'draft' ? '取消草稿' : '撤回',
          danger: record.status === 'draft',
          hidden: !hasPermission('report:fill:record:cancel') || !canRunFillRecordAction(record, 'withdraw'),
          onClick: () => {
            Modal.confirm({
              title: record.status === 'draft' ? '取消该草稿？' : '撤回该填报？',
              content: '操作后当前记录将变为已取消。',
              onOk: () => handleWithdraw(record),
            });
          },
        }] : [{
          key: 'review',
          label: '审核',
          hidden: !canRunFillRecordAction(record, 'review', canReview),
          onClick: () => {
            setReviewDecision('approved');
            reviewModal.openEdit(record);
          },
        }]),
      ],
    }),
  ];

  const mineColumns = createColumns(false);
  const adminColumns = createColumns(true);

  const mineKeyword = (
    <KeywordInput placeholder="搜索模板名称/编码" value={mineDraft.keyword} onChange={(value) => setMineDraft((current) => ({ ...current, keyword: value }))} onSearch={() => {
        minePagination.setPage(1);
        setMineSubmitted(mineDraft);
        void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordMineLists });
      }} />
  );
  const templateFilter = (value: number | undefined, onChange: (value?: number) => void) => canCreate ? (
    <FilterSelect
      placeholder="全部模板"
      items={templates.map((template) => ({ value: template.id, label: template.name }))}
      value={value}
      onChange={(next) => onChange(next)}
      width={160}
      filter
    />
  ) : null;
  const statusFilter = (value: ReportFillRecordStatus | undefined, onChange: (value?: ReportFillRecordStatus) => void) => (
    <StatusSelect
      items={REPORT_FILL_RECORD_STATUS_OPTIONS}
      value={value}
      onChange={(next) => onChange(next as ReportFillRecordStatus | undefined)}
    />
  );

  const detail = detailQuery.data;
  const detailTask = detail?.syncTaskId ? taskMap.get(detail.syncTaskId) : undefined;

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)}>
        <TabPane tab="我的填报" itemKey="mine">
          <SearchToolbar
            primary={(
              <>
                {mineKeyword}
                <SearchButton onClick={() => {
                    minePagination.setPage(1);
                    setMineSubmitted(mineDraft);
                    void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordMineLists });
                  }} />
                <ResetButton onClick={() => {
                    setMineDraft(DEFAULT_MINE);
                    setMineSubmitted(DEFAULT_MINE);
                    minePagination.setPage(1);
                    void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordMineLists });
                  }} />
              </>
            )}
            filters={(
              <>
                {statusFilter(mineDraft.status, (status) => setMineDraft((current) => ({ ...current, status })))}
                {templateFilter(mineDraft.templateId, (templateId) => setMineDraft((current) => ({ ...current, templateId })))}
              </>
            )}
            actions={canCreate ? (
              <Button type="primary" icon={<ClipboardPlus size={14} />} onClick={() => openEntry()}>新增填报</Button>
            ) : null}
            mobilePrimary={(
              <>
                {mineKeyword}
                <SearchButton onClick={() => {
                  minePagination.setPage(1);
                  setMineSubmitted(mineDraft);
                }} />
                {canCreate && (
                  <Button type="primary" icon={<ClipboardPlus size={14} />} onClick={() => openEntry()}>新增</Button>
                )}
              </>
            )}
            mobileFilters={(
              <>
                {statusFilter(mineDraft.status, (status) => setMineDraft((current) => ({ ...current, status })))}
                {templateFilter(mineDraft.templateId, (templateId) => setMineDraft((current) => ({ ...current, templateId })))}
              </>
            )}
          />
          <ConfigurableTable
            bordered
            rowKey="id"
            columns={mineColumns}
            dataSource={mineQuery.data?.list ?? []}
            loading={mineQuery.isFetching}
            pagination={minePagination.buildPagination(mineQuery.data?.total ?? 0)}
            onRefresh={() => void mineQuery.refetch()}
            refreshLoading={mineQuery.isFetching}
            columnSettingsKey="report-fill-records-mine"
          />
        </TabPane>
        {canReview && (
          <TabPane tab="审核管理" itemKey="admin">
            <SearchToolbar
              primary={(
                <>
                  {statusFilter(adminDraft.status, (status) => setAdminDraft((current) => ({ ...current, status })))}
                  <SearchButton onClick={() => {
                      adminPagination.setPage(1);
                      setAdminSubmitted(adminDraft);
                      void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordAdminLists });
                    }} />
                  <ResetButton onClick={() => {
                      setAdminDraft(DEFAULT_ADMIN);
                      setAdminSubmitted(DEFAULT_ADMIN);
                      adminPagination.setPage(1);
                      void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordAdminLists });
                    }} />
                </>
              )}
              filters={(
                <>
                  {templateFilter(adminDraft.templateId, (templateId) => setAdminDraft((current) => ({ ...current, templateId })))}
                  <FilterSelect
                    placeholder="全部提交人"
                    items={users.map((user) => ({ value: user.id, label: user.nickname || user.username }))}
                    value={adminDraft.submitterId}
                    onChange={(value) => setAdminDraft((current) => ({ ...current, submitterId: value }))}
                    width={150}
                    filter
                  />
                </>
              )}
              actions={hasPermission('report:fill:record:export') ? (
                <ExportButton
                  entity="report.fill-records"
                  query={{
                    status: adminSubmitted.status,
                    templateId: adminSubmitted.templateId,
                    submitterId: adminSubmitted.submitterId,
                  }}
                  executionMode="async"
                />
              ) : null}
              mobilePrimary={(
                <>
                  {statusFilter(adminDraft.status, (status) => setAdminDraft((current) => ({ ...current, status })))}
                  <SearchButton onClick={() => {
                    adminPagination.setPage(1);
                    setAdminSubmitted(adminDraft);
                  }} />
                </>
              )}
              mobileActions={hasPermission('report:fill:record:export') ? (
                <ExportButton
                  variant="flat"
                  entity="report.fill-records"
                  query={{
                    status: adminSubmitted.status,
                    templateId: adminSubmitted.templateId,
                    submitterId: adminSubmitted.submitterId,
                  }}
                  executionMode="async"
                />
              ) : null}
            />
            <ConfigurableTable
              bordered
              rowKey="id"
              columns={adminColumns}
              dataSource={adminQuery.data?.list ?? []}
              loading={adminQuery.isFetching}
              pagination={adminPagination.buildPagination(adminQuery.data?.total ?? 0)}
              onRefresh={() => void adminQuery.refetch()}
              refreshLoading={adminQuery.isFetching}
              columnSettingsKey="report-fill-records-admin"
            />
          </TabPane>
        )}
      </Tabs>

      <SideSheet
        title={detail ? `填报记录 #${detail.id}` : '填报详情'}
        visible={Boolean(detailId)}
        width={680}
        onCancel={() => setDetailId(undefined)}
        footer={detail ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {detail.workflowInstanceId && (
              <Button onClick={() => navigate(`/workflow/instance/${detail.workflowInstanceId}`)}>查看工作流</Button>
            )}
            {canRunFillRecordAction(detail, 'edit') && hasPermission('report:fill:record:update') && (
              <Button type="primary" onClick={() => openEntry(detail)}>编辑记录</Button>
            )}
            {canRunFillRecordAction(detail, 'review', canReview) && (
              <>
                <Button type="danger" onClick={() => {
                  setReviewDecision('rejected');
                  reviewModal.openEdit(detail);
                }}>拒绝</Button>
                <Button type="primary" onClick={() => {
                  setReviewDecision('approved');
                  reviewModal.openEdit(detail);
                }}>通过</Button>
              </>
            )}
          </div>
        ) : null}
      >
        {detailQuery.isLoading ? <Spin /> : detailQuery.isError ? (
          <Banner type="danger" closeIcon={null} description={detailQuery.error.message} />
        ) : detail ? (
          <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
            <Descriptions
              row
              data={[
                { key: '状态', value: recordStatusTag(detail.status) },
                { key: '模板', value: detail.templateName || `模板 #${detail.templateId}` },
                { key: '提交人', value: detail.submitterName || `用户 #${detail.submitterId}` },
                { key: '模板版本', value: detail.templateRevision },
                { key: '提交时间', value: detail.submittedAt ? formatDateTime(detail.submittedAt) : '—' },
                { key: '审核时间', value: detail.reviewedAt ? formatDateTime(detail.reviewedAt) : '—' },
                { key: '审核意见', value: detail.reviewComment || '—' },
              ]}
            />
            {detailTask && <AsyncTaskProgress task={detailTask} />}
            {detail.syncError && <Banner type="danger" closeIcon={null} description={detail.syncError} />}
            {detail.status === 'approved' && detail.generatedDatasetId && (
              <div>
                <Banner type="success" closeIcon={null} description={`已同步为治理数据集 #${detail.generatedDatasetId}`} />
                <div>
                  <Button
                    theme="borderless"
                    onClick={() => navigate(`/report/datasets?resourceId=${detail.generatedDatasetId}`)}
                  >
                    查看数据集
                  </Button>
                </div>
              </div>
            )}
            <div style={{ width: '100%' }}>
              <Typography.Title heading={6}>冻结表单快照</Typography.Title>
              <WorkflowFormRenderer
                fields={detail.templateSchemaSnapshot.fields}
                initValues={detail.data}
                readOnly
                labelPosition={detail.templateSchemaSnapshot.settings?.labelPosition}
                labelAlign={detail.templateSchemaSnapshot.settings?.labelAlign}
                labelWidth={detail.templateSchemaSnapshot.settings?.labelWidth}
              />
            </div>
          </Space>
        ) : null}
      </SideSheet>

      <AppModal
        title={reviewDecision === 'approved' ? '通过填报' : '拒绝填报'}
        visible={reviewModal.visible}
        width={500}
        onCancel={reviewModal.close}
        onOk={reviewModal.modalProps.onOk}
        okButtonProps={{ ...reviewModal.modalProps.okButtonProps, type: reviewDecision === 'approved' ? 'primary' : 'danger' }}
        closeOnEsc
      >
        <Form
          {...reviewModal.formProps}
          key={`${reviewModal.formKey}-${reviewDecision}`}
        >
          <Form.TextArea
            field="comment"
            label="审核意见"
            rules={reviewDecision === 'rejected' ? [{ required: true, message: '拒绝时必须填写原因' }] : undefined}
            maxCount={1000}
            rows={4}
          />
        </Form>
      </AppModal>

      <AppModal
        title="选择填报模板"
        visible={entryVisible}
        width={520}
        onCancel={() => setEntryVisible(false)}
        onOk={async () => {
          const values = await entryFormApi.current?.validate() as { templateId: number };
          const template = templates.find((item) => item.id === Number(values.templateId));
          if (!template) { Toast.error('模板不存在或已下线'); abortSubmit(); }
          setEntryVisible(false);
          navigate(`/report/fill/${encodeURIComponent(template.code)}`, { state: { tabTitle: `填报·${template.name}` } });
        }}
      >
        <Form labelPosition="left" labelWidth={90} getFormApi={(api) => { entryFormApi.current = api; }}>
          <Form.Select
            field="templateId"
            label="填报模板"
            style={{ width: '100%' }}
            rules={[{ required: true, message: '请选择填报模板' }]}
            optionList={templates.map((template) => ({ value: template.id, label: `${template.name}（${template.code}）` }))}
            filter
          />
        </Form>
      </AppModal>
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  SideSheet,
  Space,
  Spin,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ClipboardPlus, ExternalLink, RotateCcw, Search } from 'lucide-react';
import {
  REPORT_FILL_RECORD_STATUS_LABELS,
  REPORT_FILL_RECORD_STATUS_OPTIONS,
  REPORT_FILL_SYNC_STATUS_LABELS,
  type AsyncTask,
  type ReportFillRecord,
  type ReportFillRecordStatus,
} from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import AppModal from '@/components/AppModal';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
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
  const [activeTab, setActiveTab] = useState<'mine' | 'admin'>('mine');
  const minePagination = usePagination();
  const adminPagination = usePagination();
  const [mineDraft, setMineDraft] = useState<MineFilters>(DEFAULT_MINE);
  const [mineSubmitted, setMineSubmitted] = useState<MineFilters>(DEFAULT_MINE);
  const [adminDraft, setAdminDraft] = useState<AdminFilters>(DEFAULT_ADMIN);
  const [adminSubmitted, setAdminSubmitted] = useState<AdminFilters>(DEFAULT_ADMIN);
  const [detailId, setDetailId] = useState<number>();
  const [reviewTarget, setReviewTarget] = useState<ReportFillRecord | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved');
  const [entryVisible, setEntryVisible] = useState(false);
  const reviewFormApi = useRef<FormApi | null>(null);
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
    navigate(`/report/fill/${encodeURIComponent(entryCode)}?recordId=${record.id}`);
  }

  async function handleWithdraw(record: ReportFillRecord) {
    try {
      await withdrawMutation.mutateAsync({
        id: record.id,
        values: { expectedRevision: record.revision, reason: '用户主动撤回' },
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

  async function handleReview() {
    if (!reviewTarget) return;
    const values = await reviewFormApi.current?.validate() as { comment?: string };
    try {
      await reviewMutation.mutateAsync({
        id: reviewTarget.id,
        values: {
          decision: reviewDecision,
          expectedRevision: reviewTarget.revision,
          comment: values.comment?.trim() || undefined,
        },
      });
      Toast.success(reviewDecision === 'approved' ? '审核已通过' : '记录已拒绝');
      setReviewTarget(null);
      if (detailId === reviewTarget.id) void detailQuery.refetch();
    } catch (error) {
      if (isRevisionConflict(error)) {
        Modal.warning({
          title: '审核冲突',
          content: '该记录已被其他审核人处理，请刷新最新状态。',
          onOk: () => {
            setReviewTarget(null);
            void adminQuery.refetch();
          },
        });
        return;
      }
      throw error;
    }
  }

  const createColumns = (admin: boolean): ColumnProps<ReportFillRecord>[] => [
    { title: '记录号', dataIndex: 'id', width: 90, render: (value: number) => `#${value}` },
    { title: '模板', dataIndex: 'templateName', width: 180, render: (value: string | null, record) => value || `模板 #${record.templateId}` },
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
    { title: '提交时间', dataIndex: 'submittedAt', width: 170, render: (value: string | null) => value ? formatDateTime(value) : '—' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value: string) => formatDateTime(value) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: ReportFillRecordStatus) => recordStatusTag(value),
    },
    createOperationColumn<ReportFillRecord>({
      width: 170,
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
            setReviewTarget(record);
          },
        }]),
      ],
    }),
  ];

  const mineColumns = createColumns(false);
  const adminColumns = createColumns(true);

  const mineKeyword = (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索模板名称/编码"
      value={mineDraft.keyword}
      onChange={(value) => setMineDraft((current) => ({ ...current, keyword: value }))}
      showClear
      style={{ width: 220 }}
      onEnterPress={() => {
        minePagination.setPage(1);
        setMineSubmitted(mineDraft);
        void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordLists });
      }}
    />
  );
  const templateFilter = (value: number | undefined, onChange: (value?: number) => void) => canCreate ? (
    <Select
      placeholder="全部模板"
      value={value}
      optionList={templates.map((template) => ({ value: template.id, label: template.name }))}
      onChange={(next) => onChange(next ? Number(next) : undefined)}
      showClear
      filter
      style={{ width: 160 }}
    />
  ) : null;
  const statusFilter = (value: ReportFillRecordStatus | undefined, onChange: (value?: ReportFillRecordStatus) => void) => (
    <Select
      placeholder="全部状态"
      value={value}
      optionList={REPORT_FILL_RECORD_STATUS_OPTIONS}
      onChange={(next) => onChange(next as ReportFillRecordStatus | undefined)}
      showClear
      style={{ width: 130 }}
    />
  );

  const detail = detailQuery.data;
  const detailTask = detail?.syncTaskId ? taskMap.get(detail.syncTaskId) : undefined;

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)}>
        <TabPane tab="我的填报" itemKey="mine">
          <SearchToolbar
            primary={(
              <>
                {mineKeyword}
                <Button
                  type="primary"
                  icon={<Search size={14} />}
                  onClick={() => {
                    minePagination.setPage(1);
                    setMineSubmitted(mineDraft);
                    void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordLists });
                  }}
                >
                  查询
                </Button>
                <Button
                  type="tertiary"
                  icon={<RotateCcw size={14} />}
                  onClick={() => {
                    setMineDraft(DEFAULT_MINE);
                    setMineSubmitted(DEFAULT_MINE);
                    minePagination.setPage(1);
                    void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordLists });
                  }}
                >
                  重置
                </Button>
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
                <Button type="primary" icon={<Search size={14} />} onClick={() => {
                  minePagination.setPage(1);
                  setMineSubmitted(mineDraft);
                }}>查询</Button>
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
            scroll={{ x: 1300 }}
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
                  <Button
                    type="primary"
                    icon={<Search size={14} />}
                    onClick={() => {
                      adminPagination.setPage(1);
                      setAdminSubmitted(adminDraft);
                      void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordLists });
                    }}
                  >
                    查询
                  </Button>
                  <Button
                    type="tertiary"
                    icon={<RotateCcw size={14} />}
                    onClick={() => {
                      setAdminDraft(DEFAULT_ADMIN);
                      setAdminSubmitted(DEFAULT_ADMIN);
                      adminPagination.setPage(1);
                      void queryClient.invalidateQueries({ queryKey: reportFillKeys.recordLists });
                    }}
                  >
                    重置
                  </Button>
                </>
              )}
              filters={(
                <>
                  {templateFilter(adminDraft.templateId, (templateId) => setAdminDraft((current) => ({ ...current, templateId })))}
                  <Select
                    placeholder="全部提交人"
                    value={adminDraft.submitterId}
                    optionList={users.map((user) => ({ value: user.id, label: user.nickname || user.username }))}
                    onChange={(value) => setAdminDraft((current) => ({ ...current, submitterId: value ? Number(value) : undefined }))}
                    filter
                    showClear
                    style={{ width: 150 }}
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
                  <Button type="primary" icon={<Search size={14} />} onClick={() => {
                    adminPagination.setPage(1);
                    setAdminSubmitted(adminDraft);
                  }}>查询</Button>
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
              scroll={{ x: 1400 }}
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
          <Space>
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
                  setReviewTarget(detail);
                }}>拒绝</Button>
                <Button type="primary" onClick={() => {
                  setReviewDecision('approved');
                  setReviewTarget(detail);
                }}>通过</Button>
              </>
            )}
          </Space>
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
        visible={Boolean(reviewTarget)}
        width={500}
        onCancel={() => setReviewTarget(null)}
        onOk={() => void handleReview()}
        confirmLoading={reviewMutation.isPending}
        okButtonProps={{ type: reviewDecision === 'approved' ? 'primary' : 'danger' }}
      >
        <Form
          key={`${reviewTarget?.id}-${reviewDecision}`}
          labelPosition="left"
          labelWidth={90}
          getFormApi={(api) => { reviewFormApi.current = api; }}
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
          if (!template) throw new Error('模板不存在或已下线');
          setEntryVisible(false);
          navigate(`/report/fill/${encodeURIComponent(template.code)}`);
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

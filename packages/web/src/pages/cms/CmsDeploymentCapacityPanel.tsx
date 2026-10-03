import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Form, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { useQueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { formatBytes } from '@zenith/shared/core';
import { CMS_DEPLOYMENT_STORAGE_LABELS, cmsDeploymentRetentionContract, type CmsDeploymentCapacityRow, type CmsDeploymentRetentionPolicy } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useMyAsyncTasks, useTaskProgressEvents } from '@/hooks/useAsyncTasks';
import { useAsyncTaskAction } from '@/hooks/queries/async-tasks';
import { useCleanupCmsDeployments, useCmsDeploymentCapacity, useCmsDeploymentCapacitySummary, useCmsDeploymentCleanupPreview, useMeasureCmsDeployments, usePinCmsDeployment, useSaveCmsDeploymentRetentionPolicy, invalidateCmsDeploymentRetention } from '@/hooks/queries/cms-deployment-retention';
import AppModal from '@/components/AppModal';
import { ModalFooter } from '@/components/ModalFooter';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { listTableProps } from '@/components/list-page';
import { confirmDanger } from '@/utils/confirm';

const TASK_TYPES = ['cms-deployment-measure', 'cms-deployment-cleanup'];
export default function CmsDeploymentCapacityPanel() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission(); const canManage = hasPermission('cms:publish:manage');
  const [siteId, setSiteId] = useState<number>(); const [policyEditor, setPolicyEditor] = useState<CmsDeploymentRetentionPolicy | null>(null); const [previewOpen, setPreviewOpen] = useState(false);
  const policyForm = useRef<FormApi | null>(null);
  const pagination = usePagination({ resetKey: siteId }); const qc = useQueryClient();
  const list = useCmsDeploymentCapacity({ siteId: siteId ?? 0, page: pagination.page, pageSize: pagination.pageSize });
  const summary = useCmsDeploymentCapacitySummary(siteId); const preview = useCmsDeploymentCleanupPreview(siteId, previewOpen);
  const save = useSaveCmsDeploymentRetentionPolicy(); const pin = usePinCmsDeployment(); const measure = useMeasureCmsDeployments(); const cleanup = useCleanupCmsDeployments();
  const taskState = useMyAsyncTasks({ taskTypes: TASK_TYPES }); const cancel = useAsyncTaskAction('cancel'); const resume = useAsyncTaskAction('resume');
  useTaskProgressEvents(useCallback(task => { if (TASK_TYPES.includes(task.taskType) && Number(task.payload.siteId) === siteId && ['success', 'failed', 'cancelled'].includes(task.status)) invalidateCmsDeploymentRetention(qc); }, [qc, siteId]));
  const tasks = taskState.tasks.filter(task => Number(task.payload.siteId) === siteId).slice(0, 3);
  const confirmCleanup = () => {
    const proposed = preview.data; const proposedSite = siteId;
    if (!proposed?.candidates.length || !proposedSite || preview.isFetching) return;
    confirmDanger({ title: `回收这 ${proposed.candidates.length} 个历史部署？`, content: '后台任务执行时会再次检查在线版本、保留标记和依赖关系；受保护对象会跳过。', onOk: async () => {
      await cleanup.mutateAsync({ params: { id: proposedSite }, body: { fingerprint: proposed.fingerprint, deploymentIds: proposed.candidates.map(row => row.id) } });
      setPreviewOpen(false); await taskState.refresh();
    } });
  };
  return <div className="zx-flat-panels">
    <Space wrap style={{ marginBottom: 16 }}><CmsSiteSelect value={siteId} onChange={id => { setSiteId(id); setPreviewOpen(false); setPolicyEditor(null); }} width={240} />
      {canManage && siteId ? <><Button disabled={!summary.data} onClick={() => setPolicyEditor(summary.data!.policy)}>保留策略</Button><Button loading={measure.isPending} onClick={async () => { await measure.mutateAsync({ params: { id: siteId } }); await taskState.refresh(); }}>刷新容量</Button><Button type="warning" onClick={() => setPreviewOpen(true)}>预览存储回收</Button></> : null}
      <Button disabled={!siteId} onClick={() => { invalidateCmsDeploymentRetention(qc); void taskState.refresh(); }}>刷新列表</Button>
    </Space>
    {summary.data ? <><StatGrid><StatCard title="保留部署" value={summary.data.retained} /><StatCard title="受保护部署" value={summary.data.protected} /><StatCard title="可回收部署" value={summary.data.eligible} /><StatCard title="已测量占用" value={formatBytes(summary.data.schemaBytes + summary.data.fileBytes)} /></StatGrid>
      <Typography.Paragraph type="tertiary">当前策略：保留最近 {summary.data.policy.retainCount} 个上线版本或 {summary.data.policy.retainDays} 天内的部署；失败部署保留 {summary.data.policy.failedRetainDays} 天。自动回收{summary.data.policy.automatic ? '已启用' : '未启用'}。</Typography.Paragraph>
      {summary.data.unmeasured ? <Banner type="info" closeIcon={null} description={`还有 ${summary.data.unmeasured} 个部署尚未测量，占用合计仅包含已测量数据。点击“刷新容量”在后台计算。`} /> : null}</> : null}
    {summary.isError || list.isError ? <Banner type="danger" description={summary.error?.message ?? list.error?.message} /> : null}
    {tasks.map(task => <Space key={task.id} wrap style={{ marginBlock: 8 }}><Typography.Text>{task.title} #{task.id}</Typography.Text><AsyncTaskProgress task={task} />
      {['pending', 'running'].includes(task.status) ? <Button loading={cancel.isPending} onClick={() => void cancel.mutateAsync({ params: { id: task.id } }).then(() => taskState.refresh())}>取消</Button> : null}
      {['failed', 'cancelled'].includes(task.status) ? <Button loading={resume.isPending} onClick={() => void resume.mutateAsync({ params: { id: task.id } }).then(() => taskState.refresh())}>继续未完成步骤</Button> : null}
      {task.errorMessage ? <Typography.Text type="danger">{task.errorMessage}</Typography.Text> : null}</Space>)}
    <ConfigurableTable<CmsDeploymentCapacityRow> columnSettingsKey="cms-deployment-capacity" columns={[
      { title: '部署', dataIndex: 'id', width: 90, render: value => `#${value}` },
      { title: '发布单', dataIndex: 'releaseName', minWidth: 190, render: (value: string, row) => <Typography.Text link ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%', '--semi-color-link': 'var(--semi-color-primary)', '--semi-color-link-hover': 'var(--semi-color-primary-hover)', '--semi-color-link-active': 'var(--semi-color-primary-active)', '--semi-color-link-visited': 'var(--semi-color-primary)' } as CSSProperties} onClick={() => navigate(`/cms/publishing?tab=releases&site=${row.siteId}&release=${row.releaseId}`)}>{value}</Typography.Text> },
      { title: '存储状态', width: 100, render: (_, row) => <Tag>{CMS_DEPLOYMENT_STORAGE_LABELS[row.storageState]}</Tag> },
      { title: '数据库 / 文件', width: 180, render: (_, row) => `${row.schemaBytes == null ? '未知' : formatBytes(row.schemaBytes)} / ${row.fileBytes == null ? '未知' : formatBytes(row.fileBytes)}` },
      dateTimeColumn('测量时间', 'measuredAt', { empty: '尚未测量' }),
      { title: '保护与回收说明', width: 360, render: (_, row) => <Space vertical align="start" spacing={3} style={{ maxWidth: '100%' }}>{renderEllipsis(row.protectedReasons.join('；') || '符合当前回收策略')}{row.error ? <Typography.Text ellipsis={{ showTooltip: true }} type="danger" style={{ maxWidth: '100%' }}>{row.error}</Typography.Text> : null}</Space> },
      createOperationColumn<CmsDeploymentCapacityRow>({ width: 120, desktopInlineKeys: ['pin'], actions: row => canManage && row.storageState === 'available' ? [{ key: 'pin', label: row.pinned ? '解除保留' : '保留版本', onClick: () => { confirmDanger({ title: row.pinned ? '解除重要版本标记？' : '保留这个部署版本？', content: row.pinned ? '解除后仍按保留策略和运行引用判断，不会立即删除。' : '重要版本始终排除在存储回收范围之外。', onOk: () => pin.mutateAsync({ params: { id: row.id }, body: { expectedVersion: row.version, pinned: !row.pinned, reason: row.pinned ? null : '人工保留重要版本' } }) }); } }] : [] }),
    ]} {...listTableProps(list, { rowKey: 'id', pagination: pagination.buildPagination, empty: siteId ? '当前站点尚无部署' : '请选择站点' })} />
    <AppModal title="部署存储保留策略" visible={!!policyEditor} onCancel={() => setPolicyEditor(null)} footer={<ModalFooter onCancel={() => setPolicyEditor(null)} onOk={() => policyForm.current?.submitForm()} okText="保存策略" loading={save.isPending} />}>
      {policyEditor ? <Form<BodyOf<typeof cmsDeploymentRetentionContract.savePolicy>> key={`${policyEditor.siteId}:${policyEditor.version}`} getFormApi={api => { policyForm.current = api; }} initValues={{ ...policyEditor, expectedVersion: policyEditor.version }} onSubmit={async values => { await save.mutateAsync({ params: { id: policyEditor.siteId }, body: values }); setPolicyEditor(null); }}>
        <Form.InputNumber field="retainCount" label="至少保留最近上线版本数" min={1} max={1000} rules={[{ required: true }]} />
        <Form.InputNumber field="retainDays" label="已完成部署保留天数" min={1} max={3650} rules={[{ required: true }]} />
        <Form.InputNumber field="failedRetainDays" label="失败部署保留天数" min={0} max={3650} rules={[{ required: true }]} />
        <Form.Switch field="automatic" label="每日自动回收符合策略的部署" />
        <Typography.Paragraph type="tertiary">在线、重要、构建中、待激活和被执行任务引用的部署始终受保护。已提交的回收任务可单独取消。</Typography.Paragraph>
      </Form> : null}
    </AppModal>
    <AppModal title="预览历史部署存储回收" visible={previewOpen} onCancel={() => setPreviewOpen(false)} width={860} footer={<ModalFooter onCancel={() => setPreviewOpen(false)} onOk={confirmCleanup} okText="确认回收本批部署" okType="danger" disabled={!preview.data?.candidates.length || preview.isFetching} loading={cleanup.isPending} />}>
      <Spin spinning={preview.isFetching}>
        {preview.isError ? <Banner type="danger" description={preview.error.message} /> : null}
        {preview.data ? <><Typography.Paragraph>本批可回收 {preview.data.candidates.length} 个部署（符合策略共 {preview.data.totalCandidates} 个），已知空间 {formatBytes(preview.data.bytes)}，{preview.data.protectedCount} 个部署受保护。</Typography.Paragraph>
          {preview.data.unmeasured ? <Banner type="info" closeIcon={null} description={`${preview.data.unmeasured} 个候选尚未测量，因此空间合计不完整。`} /> : null}
          <Typography.Paragraph type="tertiary">回收后保留发布审计记录，该部署无法回滚。取消会停止剩余步骤，已完成的回收保留。</Typography.Paragraph>
          <ConfigurableTable<CmsDeploymentCapacityRow> columns={[{ title: '部署', dataIndex: 'id', width: 90 }, { title: '发布单', dataIndex: 'releaseName', minWidth: 200 }, { title: '创建时间', dataIndex: 'createdAt', width: 180 }, { title: '存储状态', dataIndex: 'storageState', width: 100, render: (value: CmsDeploymentCapacityRow['storageState']) => CMS_DEPLOYMENT_STORAGE_LABELS[value] }]} dataSource={preview.data.candidates} rowKey="id" pagination={{ pageSize: 10 }} />
        </> : null}
      </Spin>
    </AppModal>
  </div>;
}

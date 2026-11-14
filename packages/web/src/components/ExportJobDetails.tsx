import { Banner, Button, Descriptions, SideSheet, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { useExportJobDetail } from '@/hooks/queries/export-jobs';
import { EXPORT_SCOPE_LABELS } from '@zenith/shared/tasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { useAsyncTaskDetail } from '@/hooks/queries/async-tasks';
export default function ExportJobDetails({ id, onClose }: Readonly<{ id: number; onClose: () => void }>) {
  const detail = useExportJobDetail(id);
  const job = detail.data;
  const taskQuery = useAsyncTaskDetail(job?.taskId ?? undefined);
  const task = taskQuery.data;
  return <SideSheet title={'导出任务 #' + id} visible onCancel={onClose} width={720}>
    {detail.isPending && <Spin tip="正在加载导出任务" />}
    {detail.isError && <Banner type="danger" closeIcon={null} description={<Space vertical align="start"><Typography.Text>任务不存在、已删除或无权查看。</Typography.Text><Button onClick={() => void detail.refetch()}>重试</Button></Space>} />}
    {job && <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
      <Tag>{job.status}</Tag>
      <Descriptions data={[
        { key: '来源', value: job.moduleName + ' · ' + job.entity },
        { key: '范围', value: EXPORT_SCOPE_LABELS[job.scope ?? 'filtered'] },
        { key: '格式', value: job.format.toUpperCase() },
        { key: '阶段', value: job.stage ?? job.status },
        { key: '进度', value: job.processedRows + ' / ' + (job.totalRows ?? '待计算') },
        { key: '文件', value: job.filename ?? '待生成' },
        { key: '到期', value: job.expiresAt ?? '完成后起算' },
        { key: '模式', value: job.raw ? '明文' : '按字段策略脱敏' },
        { key: '字段', value: job.columns?.join('、') ?? '默认字段' },
        { key: '任务中心', value: job.taskId ?? '同步执行' },
        { key: '执行次数', value: task ? task.attempts + ' / ' + task.maxAttempts : '—' },
        { key: '下次重试', value: task?.nextRunAt ?? '—' },
      ]} />
      {task && (job.status === 'pending' || job.status === 'running') && <AsyncTaskProgress task={task} />}
      {job.status === 'success' && <Typography.Text type="success">文件已生成</Typography.Text>}
      <Typography.Text strong>SHA256</Typography.Text><Typography.Paragraph copyable style={{ wordBreak: 'break-all' }}>{job.sha256 ?? '尚未生成校验和'}</Typography.Paragraph>
      <Typography.Text strong>查询规格</Typography.Text><Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(job.query, null, 2)}</Typography.Paragraph>
      {job.manifest && <><Typography.Text strong>分卷清单</Typography.Text><Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(job.manifest, null, 2)}</Typography.Paragraph></>}
      {job.errorMessage && <Typography.Paragraph type="danger" style={{ whiteSpace: 'pre-wrap' }}>{job.errorMessage}</Typography.Paragraph>}
    </Space>}
  </SideSheet>;
}


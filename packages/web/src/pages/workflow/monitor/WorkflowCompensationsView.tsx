import { useState } from 'react';
import { Button, Descriptions, Divider, Empty, Modal, Select, SideSheet, Space, Tag, Timeline, Toast, TextArea, Typography, Upload } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Paperclip } from 'lucide-react';
import type { WorkflowCompensation } from '@zenith/shared';
import { request } from '@/utils/request';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  useWorkflowCompensationAction,
  useWorkflowCompensationDetail,
  useWorkflowCompensationList,
} from '@/hooks/queries/workflow-monitor';

const STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: '待修复', color: 'amber' },
  resolved: { text: '已放行', color: 'green' },
  terminated: { text: '已终止', color: 'red' },
};
const ACTION_STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: '待执行', color: 'amber' },
  running: { text: '执行中', color: 'blue' },
  succeeded: { text: '已成功', color: 'green' },
  failed: { text: '执行失败', color: 'red' },
};
const ACTION_LABEL: Record<string, string> = {
  continue: '继续', retry: '重试', compensate: '反向补偿', fallback: '备用兜底', notify: '通知挂起', terminate: '终止', toAdmin: '转管理员',
};
const LOG_LABEL: Record<string, string> = {
  note: '备注', attachment: '附件', auto: '自动动作', retry: '重试', resume: '恢复推进', resolve: '放行', terminate: '终止',
};
type Attachment = { id: number; name: string; url: string };

export default function WorkflowCompensationsView() {
  const { hasPermission } = usePermission();
  const canOperate = hasPermission('workflow:engine:operate');
  const { page, pageSize, buildPagination } = usePagination();
  const [status, setStatus] = useState<string | undefined>('pending');
  const listQuery = useWorkflowCompensationList({ page, pageSize, status });
  const data = listQuery.data ?? null;
  const [detailId, setDetailId] = useState<number | undefined>();
  const detailQuery = useWorkflowCompensationDetail(detailId, detailId !== undefined);
  const detail = detailQuery.data ?? null;
  const detailLoading = detailQuery.isFetching;
  const [noteText, setNoteText] = useState('');
  const [pendingAtt, setPendingAtt] = useState<Attachment[]>([]);
  const actionMutation = useWorkflowCompensationAction();
  const acting = actionMutation.isPending;

  const openDetail = (id: number) => {
    setDetailId(id);
    setNoteText('');
    setPendingAtt([]);
  };

  const resolve = (r: WorkflowCompensation, action: 'resolve' | 'terminate') => { Modal.confirm({
    title: action === 'resolve' ? '标记修复放行' : '终止流程',
    content: action === 'resolve' ? '确认异常已处理，流程继续？' : '将终止该实例并跳过待办，不可恢复',
    okButtonProps: action === 'terminate' ? { type: 'danger' } : undefined,
    onOk: async () => {
      await actionMutation.mutateAsync({ id: r.id, action: 'resolve', body: { action } });
      Toast.success('已处理');
      if (detail?.id === r.id) setDetailId(undefined);
    },
  }); };

  const doResume = (id: number) => { Modal.confirm({
    title: '恢复后继续推进', content: '确认补偿已完成？将从失败节点继续推进流程。',
    onOk: async () => {
      await actionMutation.mutateAsync({ id, action: 'resume' });
      Toast.success('已恢复推进');
      void detailQuery.refetch();
    },
  }); };
  const doRetry = async (id: number) => {
    await actionMutation.mutateAsync({ id, action: 'retry' });
    Toast.success('已重新入队');
    void detailQuery.refetch();
  };
  const doNote = async (id: number) => {
    if (!noteText.trim() && !pendingAtt.length) { Toast.warning('请输入备注或添加附件'); return; }
    await actionMutation.mutateAsync({ id, action: 'note', body: { note: noteText.trim() || undefined, attachments: pendingAtt.length ? pendingAtt : undefined } });
    setNoteText('');
    setPendingAtt([]);
    void detailQuery.refetch();
  };

  const columns: ColumnProps<WorkflowCompensation>[] = [
    { title: '实例', dataIndex: 'instanceId', width: 80, render: (v: number) => `#${v}` },
    { title: '节点', dataIndex: 'nodeName', width: 120, render: renderEllipsis },
    { title: '错误', dataIndex: 'errorMessage', render: renderEllipsis },
    { title: '处理动作', dataIndex: 'action', width: 90, render: (a: string) => ACTION_LABEL[a] ?? a },
    { title: '自动动作', dataIndex: 'compensationActionStatus', width: 90, render: (s: string) => (s && s !== 'none' ? <Tag color={ACTION_STATUS[s]?.color as never}>{ACTION_STATUS[s]?.text ?? s}</Tag> : <Typography.Text type="tertiary">—</Typography.Text>) },
    { title: '状态', dataIndex: 'status', width: 84, fixed: 'right', render: (s: string) => <Tag color={STATUS[s]?.color as never}>{STATUS[s]?.text ?? s}</Tag> },
    createdAtColumn,
    createOperationColumn<WorkflowCompensation>({
      actions: (r) => [
        { key: 'detail', label: '详情', onClick: () => openDetail(r.id) },
        { key: 'resume', label: '恢复', hidden: !canOperate || r.status !== 'pending', onClick: () => doResume(r.id) },
        { key: 'resolve', label: '放行', hidden: !canOperate || r.status !== 'pending', onClick: () => resolve(r, 'resolve') },
        { key: 'terminate', label: '终止', danger: true, hidden: !canOperate || r.status !== 'pending', onClick: () => resolve(r, 'terminate') },
      ],
    }),
  ];

  return (
    <div>
      <SearchToolbar primary={(
        <Space>
          <Select value={status} onChange={(v) => setStatus(v as string)} placeholder="状态" style={{ width: 130 }} showClear
            optionList={[{ value: 'pending', label: '待修复' }, { value: 'resolved', label: '已放行' }, { value: 'terminated', label: '已终止' }]} />
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => void listQuery.refetch()}>刷新</Button>
          <Typography.Text type="tertiary" size="small">异常捕获 / 补偿产生的修复工单</Typography.Text>
        </Space>
      )} />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small" empty="暂无补偿工单" pagination={buildPagination(data?.total ?? 0)} />

      <SideSheet title={`补偿工单 #${detail?.id ?? ''}`} visible={detailId !== undefined || detailLoading} onCancel={() => setDetailId(undefined)} width={520}>
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions row size="small" data={[
              { key: '实例', value: `#${detail.instanceId}` },
              { key: '失败节点', value: detail.nodeName ?? detail.failedNodeKey ?? detail.nodeKey },
              { key: '处理动作', value: ACTION_LABEL[detail.action] ?? detail.action },
              { key: '工单状态', value: <Tag color={STATUS[detail.status]?.color as never}>{STATUS[detail.status]?.text ?? detail.status}</Tag> },
              { key: '自动动作', value: detail.compensationActionStatus === 'none' ? '无' : <Tag color={ACTION_STATUS[detail.compensationActionStatus]?.color as never}>{ACTION_STATUS[detail.compensationActionStatus]?.text ?? detail.compensationActionStatus}</Tag> },
              { key: '错误信息', value: <Typography.Text type="danger" style={{ wordBreak: 'break-all' }}>{detail.errorMessage ?? '—'}</Typography.Text> },
            ]} />

            {canOperate && detail.status === 'pending' && (
              <Space wrap>
                <Button size="small" type="primary" loading={acting} onClick={() => doResume(detail.id)}>恢复推进</Button>
                {detail.compensationActionStatus === 'failed' && <Button size="small" loading={acting} onClick={() => doRetry(detail.id)}>重试补偿动作</Button>}
                <Button size="small" onClick={() => resolve(detail, 'resolve')}>放行</Button>
                <Button size="small" type="danger" onClick={() => resolve(detail, 'terminate')}>终止</Button>
              </Space>
            )}

            <Divider margin="4px" />
            <Typography.Text strong>处理历史</Typography.Text>
            {detail.logs.length ? (
              <Timeline>
                {detail.logs.map((l) => (
                  <Timeline.Item key={l.id} time={formatDateTime(l.createdAt)} type={l.action === 'terminate' ? 'error' : l.action === 'resolve' || l.action === 'resume' ? 'success' : 'default'}>
                    <div><b>{LOG_LABEL[l.action] ?? l.action}</b>{l.operatorName ? ` · ${l.operatorName}` : ''}</div>
                    {l.note && <div style={{ color: 'var(--semi-color-text-1)' }}>{l.note}</div>}
                    {l.attachments?.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}><Paperclip size={12} />{a.name}</a>)}
                  </Timeline.Item>
                ))}
              </Timeline>
            ) : <Empty description="暂无处理记录" />}

            {canOperate && (
              <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
                <TextArea value={noteText} onChange={setNoteText} placeholder="添加处理备注…" autosize={{ minRows: 2, maxRows: 4 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <Upload
                    action=""
                    showUploadList={false}
                    customRequest={async ({ file, onSuccess, onError }) => {
                      try {
                        const fd = new FormData();
                        fd.append('file', file.fileInstance as File);
                        const res = await request.post<{ id?: number; url: string; originalName?: string }>('/api/files/upload-one', fd);
                        if (res.code === 0 && res.data?.url) {
                          setPendingAtt((prev) => [...prev, { id: res.data!.id ?? Date.now(), name: res.data!.originalName ?? (file.name || '附件'), url: res.data!.url }]);
                          onSuccess?.({}, file as never);
                        } else { onError?.({ status: 0 } as never, file as never); }
                      } catch { onError?.({ status: 0 } as never, file as never); }
                    }}
                  >
                    <Button size="small" icon={<Paperclip size={14} />}>添加附件</Button>
                  </Upload>
                  {pendingAtt.map((a, i) => <Tag key={i} closable onClose={() => setPendingAtt((prev) => prev.filter((_, j) => j !== i))}>{a.name}</Tag>)}
                  <Button size="small" type="primary" loading={acting} onClick={() => doNote(detail.id)} style={{ marginLeft: 'auto' }}>提交</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SideSheet>
    </div>
  );
}

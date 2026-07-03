import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Space, Switch, Tag, Toast, Tabs, TabPane, Banner, Typography, TextArea } from '@douyinfe/semi-ui';
import { RotateCcw, Search, RefreshCw, Briefcase } from 'lucide-react';
import type { MpMessageTemplate } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpTemplateKeys,
  useBatchSendMpTemplate,
  useDeleteMpTemplate,
  useMpTemplateIndustry,
  useMpTemplateList,
  useMpTemplateLogList,
  useSaveMpTemplateIndustry,
  useSendMpTemplate,
  useSyncMpTemplates,
} from '@/hooks/queries/mp-templates';

export default function MpTemplateMessagesPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [tab, setTab] = useState('templates');
  const tplPg = usePagination();
  const logPg = usePagination();
  const [draftLogStatus, setDraftLogStatus] = useState<string | undefined>(undefined);
  const [submittedLogStatus, setSubmittedLogStatus] = useState<string | undefined>(undefined);

  const templateQuery = useMpTemplateList(currentId, { page: tplPg.page, pageSize: tplPg.pageSize });
  const logQuery = useMpTemplateLogList(currentId, { page: logPg.page, pageSize: logPg.pageSize, status: submittedLogStatus });
  const templates = templateQuery.data?.list ?? [];
  const tplTotal = templateQuery.data?.total ?? 0;
  const logs = logQuery.data?.list ?? [];
  const logTotal = logQuery.data?.total ?? 0;

  const syncMutation = useSyncMpTemplates();
  const sendMutation = useSendMpTemplate();
  const batchSendMutation = useBatchSendMpTemplate();
  const saveIndustryMutation = useSaveMpTemplateIndustry();
  const deleteMutation = useDeleteMpTemplate();

  const [sendVisible, setSendVisible] = useState(false);
  const [sendTpl, setSendTpl] = useState<MpMessageTemplate | null>(null);
  const [sendOpenid, setSendOpenid] = useState('');
  const [sendUrl, setSendUrl] = useState('');
  const [sendData, setSendData] = useState('{\n  "key1": { "value": "示例内容" }\n}');
  const [sendBatch, setSendBatch] = useState(false);

  const [industryVisible, setIndustryVisible] = useState(false);
  const industryQuery = useMpTemplateIndustry(currentId, industryVisible);
  const [industryId1, setIndustryId1] = useState('');
  const [industryId2, setIndustryId2] = useState('');

  useEffect(() => {
    if (!industryVisible) return;
    setIndustryId1('');
    setIndustryId2('');
  }, [industryVisible]);

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncMutation.mutateAsync(currentId);
    Toast.success(`同步完成：新增 ${data.created ?? 0}，更新 ${data.updated ?? 0}`);
    tplPg.setPage(1);
  };

  const openSend = (tpl: MpMessageTemplate) => { setSendTpl(tpl); setSendOpenid(''); setSendUrl(''); setSendBatch(false); setSendData('{\n  "key1": { "value": "示例内容" }\n}'); setSendVisible(true); };

  const handleSend = async () => {
    if (!currentId || !sendTpl) return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(sendData); } catch { Toast.error('模板数据不是合法 JSON'); throw new Error('validation'); }
    const openids = sendOpenid.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean);
    if (openids.length === 0) { Toast.error('请填写接收粉丝 openid'); throw new Error('validation'); }
    if (sendBatch) {
      const res = await batchSendMutation.mutateAsync({ accountId: currentId, templateId: sendTpl.templateId, openids, url: sendUrl.trim() || undefined, data });
      Toast.success(`批量发送完成：成功 ${res.success ?? 0}，失败 ${res.failed ?? 0}`);
    } else {
      await sendMutation.mutateAsync({ accountId: currentId, templateId: sendTpl.templateId, openid: openids[0], url: sendUrl.trim() || undefined, data });
      Toast.success('发送成功');
    }
    setSendVisible(false);
    logPg.setPage(1);
  };

  const openIndustry = () => {
    if (!currentId) return;
    setIndustryVisible(true);
  };

  const handleSaveIndustry = async () => {
    if (!currentId) return;
    if (!industryId1.trim() || !industryId2.trim()) { Toast.warning('请填写主营/副营行业代码'); throw new Error('validation'); }
    await saveIndustryMutation.mutateAsync({ accountId: currentId, industryId1: industryId1.trim(), industryId2: industryId2.trim() });
    Toast.success('行业设置成功');
    setIndustryVisible(false);
  };

  const handleDeleteTpl = (record: MpMessageTemplate) => {
    Modal.confirm({
      title: `确定删除模板「${record.title}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const tplColumns = [
    { title: '模板标题', dataIndex: 'title', width: 180, render: renderEllipsis },
    { title: '模板ID', dataIndex: 'templateId', width: 200, render: renderEllipsis },
    { title: '内容', dataIndex: 'content', width: 320, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 300, whiteSpace: 'pre-wrap' }}>{v || '—'}</Typography.Text> },
    createOperationColumn<MpMessageTemplate>({
      width: 140,
      desktopInlineKeys: ['send', 'delete'],
      menuAriaLabel: '模板库操作',
      actions: (record) => [
        { key: 'send', label: '发送', hidden: !can('mp:template:send'), onClick: () => openSend(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:template:delete'), onClick: () => handleDeleteTpl(record) },
      ],
    }),
  ];

  const logColumns = [
    { title: '模板ID', dataIndex: 'templateId', width: 180, render: renderEllipsis },
    { title: '接收 openid', dataIndex: 'openid', width: 180, render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => (v === 'success' ? <Tag color="green" type="light">成功</Tag> : <Tag color="red" type="light">失败</Tag>),
    },
    { title: 'msgId', dataIndex: 'msgId', width: 140, render: (v: string | null) => v || '—' },
    { title: '错误信息', dataIndex: 'errorMsg', width: 220, render: (v: string | null) => v || '—' },
    { title: '发送时间', dataIndex: 'createdAt', width: 170 },
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderTemplateRefreshButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { tplPg.setPage(1); void queryClient.invalidateQueries({ queryKey: mpTemplateKeys.lists(currentId) }); }}>刷新</Button>
  );
  const renderTemplateActions = () => {
    if (!can('mp:template:sync')) return null;
    return (
      <>
        <Button icon={<RefreshCw size={14} />} loading={syncMutation.isPending} disabled={!currentId} onClick={() => void handleSync()}>从微信同步模板</Button>
        <Button icon={<Briefcase size={14} />} disabled={!currentId} onClick={openIndustry}>行业设置</Button>
      </>
    );
  };
  const renderLogStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftLogStatus}
      onChange={(v) => setDraftLogStatus(v as string | undefined)}
      optionList={[{ label: '成功', value: 'success' }, { label: '失败', value: 'failed' }]}
      showClear
      style={{ width: 120 }}
    />
  );
  const refreshLogs = () => {
    logPg.setPage(1);
    setSubmittedLogStatus(draftLogStatus);
    void queryClient.invalidateQueries({ queryKey: mpTemplateKeys.logLists(currentId) });
  };
  const renderLogRefreshButton = () => (
    <Button type="tertiary" icon={<Search size={14} />} onClick={refreshLogs}>刷新</Button>
  );

  const sending = sendMutation.isPending || batchSendMutation.isPending;
  const industry = industryQuery.data;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={renderAccountFilter()}
        mobilePrimary={renderAccountFilter()}
        filterTitle="模板消息筛选"
      />
      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Tabs activeKey={tab} onChange={setTab} type="line">
        <TabPane tab="模板库" itemKey="templates">
          <SearchToolbar
            primary={(
              <>
                {renderTemplateRefreshButton()}
                {renderTemplateActions()}
              </>
            )}
            mobilePrimary={renderTemplateRefreshButton()}
            mobileActions={renderTemplateActions()}
            actionTitle="模板库操作"
          />
          <ConfigurableTable bordered loading={templateQuery.isFetching} onRefresh={() => void templateQuery.refetch()} refreshLoading={templateQuery.isFetching}
            columns={tplColumns} dataSource={templates} rowKey="id"
            pagination={tplPg.buildPagination(tplTotal)} scroll={{ x: 1000 }} />
        </TabPane>
        <TabPane tab="发送记录" itemKey="logs">
          <SearchToolbar
            primary={(
              <>
                {renderLogStatusFilter()}
                {renderLogRefreshButton()}
              </>
            )}
            mobilePrimary={renderLogRefreshButton()}
            mobileFilters={renderLogStatusFilter()}
            filterTitle="发送记录筛选"
            onFilterApply={refreshLogs}
          />
          <ConfigurableTable bordered loading={logQuery.isFetching} onRefresh={() => void logQuery.refetch()} refreshLoading={logQuery.isFetching}
            columns={logColumns} dataSource={logs} rowKey="id"
            pagination={logPg.buildPagination(logTotal)} scroll={{ x: 1000 }} />
        </TabPane>
      </Tabs>

      <AppModal title={`发送模板消息 · ${sendTpl?.title ?? ''}`} visible={sendVisible}
        onOk={handleSend} onCancel={() => setSendVisible(false)} confirmLoading={sending} width={600}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="模板ID"><Input value={sendTpl?.templateId ?? ''} disabled /></Field>
          <Field label="发送方式">
            <Space>
              <Switch checked={sendBatch} onChange={setSendBatch} />
              <Typography.Text type="tertiary" size="small">{sendBatch ? '批量发送（多个 openid，每行或逗号分隔，最多 500）' : '单条发送'}</Typography.Text>
            </Space>
          </Field>
          <Field label={sendBatch ? '接收 openid 列表' : '接收 openid'}>
            {sendBatch
              ? <TextArea value={sendOpenid} onChange={setSendOpenid} rows={4} placeholder={'每行一个 openid，或用逗号分隔'} />
              : <Input value={sendOpenid} onChange={setSendOpenid} placeholder="目标粉丝 openid" />}
          </Field>
          <Field label="跳转链接"><Input value={sendUrl} onChange={setSendUrl} placeholder="点击模板消息跳转的 URL（选填）" /></Field>
          <Field label="模板数据 (JSON)">
            <TextArea value={sendData} onChange={setSendData} rows={6} style={{ fontFamily: 'monospace' }} />
            <Typography.Text type="tertiary" size="small">格式：{'{ "key": { "value": "内容", "color": "#173177" } }'}，key 对应模板 {'{{key.DATA}}'}</Typography.Text>
          </Field>
        </div>
      </AppModal>

      <AppModal title="模板消息行业设置" visible={industryVisible}
        onOk={() => void handleSaveIndustry()} confirmLoading={saveIndustryMutation.isPending} onCancel={() => setIndustryVisible(false)} width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {industry && (industry.primaryIndustry || industry.secondaryIndustry) && (
            <Banner type="info" fullMode={false} description={`当前行业：${[industry.primaryIndustry, industry.secondaryIndustry].filter(Boolean).map((i) => `${i!.firstClass}/${i!.secondClass}`).join('，') || '未设置'}`} />
          )}
          <Field label="主营行业代码"><Input value={industryId1} onChange={setIndustryId1} placeholder="如 1（IT科技/互联网）" /></Field>
          <Field label="副营行业代码"><Input value={industryId2} onChange={setIndustryId2} placeholder="如 2（IT科技/IT软件与服务）" /></Field>
          <Typography.Text type="tertiary" size="small">行业代码对照见微信公众平台「模板消息 - 设置所属行业」文档。每月可修改 1 次。</Typography.Text>
        </div>
      </AppModal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

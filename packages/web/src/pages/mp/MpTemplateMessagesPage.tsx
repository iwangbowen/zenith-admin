import { useEffect, useState, useCallback } from 'react';
import { Button, Input, Modal, Select, Space, Switch, Tag, Toast, Tabs, TabPane, Banner, Typography, TextArea } from '@douyinfe/semi-ui';
import { RotateCcw, Search, RefreshCw, Briefcase } from 'lucide-react';
import type { PaginatedResponse, MpMessageTemplate, MpTemplateSendLog } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

export default function MpTemplateMessagesPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [tab, setTab] = useState('templates');
  const [tplLoading, setTplLoading] = useState(false);
  const [templates, setTemplates] = useState<MpMessageTemplate[]>([]);
  const [tplTotal, setTplTotal] = useState(0);
  const tplPg = usePagination();
  const [syncing, setSyncing] = useState(false);

  const [logLoading, setLogLoading] = useState(false);
  const [logs, setLogs] = useState<MpTemplateSendLog[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logStatus, setLogStatus] = useState<string | undefined>(undefined);
  const logPg = usePagination();

  const [sendVisible, setSendVisible] = useState(false);
  const [sendTpl, setSendTpl] = useState<MpMessageTemplate | null>(null);
  const [sendOpenid, setSendOpenid] = useState('');
  const [sendUrl, setSendUrl] = useState('');
  const [sendData, setSendData] = useState('{\n  "key1": { "value": "示例内容" }\n}');
  const [sending, setSending] = useState(false);
  const [sendBatch, setSendBatch] = useState(false);

  const [industryVisible, setIndustryVisible] = useState(false);
  const [industry, setIndustry] = useState<{ primaryIndustry: { firstClass: string; secondClass: string } | null; secondaryIndustry: { firstClass: string; secondClass: string } | null } | null>(null);
  const [industryId1, setIndustryId1] = useState('');
  const [industryId2, setIndustryId2] = useState('');
  const [savingIndustry, setSavingIndustry] = useState(false);

  const fetchTemplates = useCallback(async (p = 1, ps = tplPg.pageSize) => {
    if (!currentId) { setTemplates([]); setTplTotal(0); return; }
    const reqId = currentId;
    setTplLoading(true);
    try {
      const res = await request.get<PaginatedResponse<MpMessageTemplate>>(`/api/mp/templates?accountId=${currentId}&page=${p}&pageSize=${ps}`);
      if (currentIdRef.current !== reqId) return; // 账号已切换，丢弃过期响应
      setTemplates(res.data?.list ?? []);
      setTplTotal(res.data?.total ?? 0);
      tplPg.setPage(res.data?.page ?? p);
      tplPg.setPageSize(res.data?.pageSize ?? ps);
    } finally { setTplLoading(false); }
  }, [currentId, currentIdRef, tplPg]);

  const fetchLogs = useCallback(async (p = 1, ps = logPg.pageSize, status = logStatus) => {
    if (!currentId) { setLogs([]); setLogTotal(0); return; }
    const reqId = currentId;
    setLogLoading(true);
    try {
      const q = new URLSearchParams({ accountId: String(currentId), page: String(p), pageSize: String(ps) });
      if (status) q.set('status', status);
      const res = await request.get<PaginatedResponse<MpTemplateSendLog>>(`/api/mp/templates/logs?${q}`);
      if (currentIdRef.current !== reqId) return; // 账号已切换，丢弃过期响应
      setLogs(res.data?.list ?? []);
      setLogTotal(res.data?.total ?? 0);
      logPg.setPage(res.data?.page ?? p);
      logPg.setPageSize(res.data?.pageSize ?? ps);
    } finally { setLogLoading(false); }
  }, [currentId, currentIdRef, logStatus, logPg]);

  useEffect(() => { void fetchTemplates(1); void fetchLogs(1); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [currentId]);

  const handleSync = async () => {
    if (!currentId) return;
    setSyncing(true);
    try {
      const res = await request.post<{ created: number; updated: number }>('/api/mp/templates/sync', { accountId: currentId });
      if (res.code === 0) { Toast.success(`同步完成：新增 ${res.data?.created ?? 0}，更新 ${res.data?.updated ?? 0}`); void fetchTemplates(1); }
    } finally { setSyncing(false); }
  };

  const openSend = (tpl: MpMessageTemplate) => { setSendTpl(tpl); setSendOpenid(''); setSendUrl(''); setSendBatch(false); setSendData('{\n  "key1": { "value": "示例内容" }\n}'); setSendVisible(true); };

  const handleSend = async () => {
    if (!currentId || !sendTpl) return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(sendData); } catch { Toast.error('模板数据不是合法 JSON'); return; }
    const openids = sendOpenid.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean);
    if (openids.length === 0) { Toast.error('请填写接收粉丝 openid'); return; }
    setSending(true);
    try {
      if (sendBatch) {
        const res = await request.post<{ success: number; failed: number; total: number }>('/api/mp/templates/batch-send', { accountId: currentId, templateId: sendTpl.templateId, openids, url: sendUrl.trim() || undefined, data });
        if (res.code === 0) { Toast.success(`批量发送完成：成功 ${res.data?.success ?? 0}，失败 ${res.data?.failed ?? 0}`); setSendVisible(false); void fetchLogs(1); }
      } else {
        const res = await request.post('/api/mp/templates/send', { accountId: currentId, templateId: sendTpl.templateId, openid: openids[0], url: sendUrl.trim() || undefined, data });
        if (res.code === 0) { Toast.success('发送成功'); setSendVisible(false); void fetchLogs(1); }
      }
    } finally { setSending(false); }
  };

  const openIndustry = async () => {
    if (!currentId) return;
    setIndustryVisible(true);
    setIndustry(null);
    const res = await request.get<typeof industry>(`/api/mp/templates/industry?accountId=${currentId}`);
    if (res.code === 0) setIndustry(res.data ?? null);
  };

  const handleSaveIndustry = async () => {
    if (!currentId) return;
    if (!industryId1.trim() || !industryId2.trim()) { Toast.warning('请填写主营/副营行业代码'); return; }
    setSavingIndustry(true);
    try {
      const res = await request.put('/api/mp/templates/industry', { accountId: currentId, industryId1: industryId1.trim(), industryId2: industryId2.trim() });
      if (res.code === 0) { Toast.success('行业设置成功'); setIndustryVisible(false); }
    } finally { setSavingIndustry(false); }
  };

  const handleDeleteTpl = (record: MpMessageTemplate) => {
    Modal.confirm({
      title: `确定删除模板「${record.title}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/mp/templates/${record.id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        void fetchTemplates();
      },
    });
  };

  const tplColumns = [
    { title: '模板标题', dataIndex: 'title', width: 180, render: renderEllipsis },
    { title: '模板ID', dataIndex: 'templateId', width: 200, render: renderEllipsis },
    { title: '内容', dataIndex: 'content', width: 320, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 300, whiteSpace: 'pre-wrap' }}>{v || '—'}</Typography.Text> },
    {
      title: '操作', key: 'actions', width: 140, fixed: 'right' as const,
      render: (_: unknown, record: MpMessageTemplate) => (
        <Space>
          {can('mp:template:send') && <Button theme="borderless" size="small" onClick={() => openSend(record)}>发送</Button>}
          {can('mp:template:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => handleDeleteTpl(record)}>删除</Button>}
        </Space>
      ),
    },
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

  return (
    <div className="page-container">
      <div style={{ marginBottom: 12 }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
      </div>
      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Tabs activeKey={tab} onChange={setTab} type="line">
        <TabPane tab="模板库" itemKey="templates">
          <SearchToolbar>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => void fetchTemplates(1)}>刷新</Button>
            {can('mp:template:sync') && <Button icon={<RefreshCw size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSync()}>从微信同步模板</Button>}
            {can('mp:template:sync') && <Button icon={<Briefcase size={14} />} disabled={!currentId} onClick={() => void openIndustry()}>行业设置</Button>}
          </SearchToolbar>
          <ConfigurableTable bordered loading={tplLoading} onRefresh={() => void fetchTemplates()} refreshLoading={tplLoading}
            columns={tplColumns} dataSource={templates} rowKey="id"
            pagination={tplPg.buildPagination(tplTotal, (p, ps) => fetchTemplates(p, ps))} scroll={{ x: 1000 }} />
        </TabPane>
        <TabPane tab="发送记录" itemKey="logs">
          <SearchToolbar>
            <Select placeholder="状态" value={logStatus} onChange={(v) => { setLogStatus(v as string | undefined); void fetchLogs(1, logPg.pageSize, v as string | undefined); }}
              optionList={[{ label: '成功', value: 'success' }, { label: '失败', value: 'failed' }]} showClear style={{ width: 120 }} />
            <Button type="tertiary" icon={<Search size={14} />} onClick={() => void fetchLogs(1)}>刷新</Button>
          </SearchToolbar>
          <ConfigurableTable bordered loading={logLoading} onRefresh={() => void fetchLogs()} refreshLoading={logLoading}
            columns={logColumns} dataSource={logs} rowKey="id"
            pagination={logPg.buildPagination(logTotal, (p, ps) => fetchLogs(p, ps))} scroll={{ x: 1000 }} />
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
        onOk={() => void handleSaveIndustry()} confirmLoading={savingIndustry} onCancel={() => setIndustryVisible(false)} width={460}>
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

import { useState } from 'react';
import { Banner, Button, Collapse, DatePicker, Descriptions, Input, InputNumber, Modal, Select, SideSheet, Space, Spin, Switch, TabPane, Tabs, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { maintenanceContract, MAINTENANCE_LOG_STATUS_OPTIONS, MAINTENANCE_ACTION_LABELS, type MaintenanceLog, type MaintenanceStatus } from '@zenith/shared/ops';
import { maintenanceContentSchema, maintenancePlanSchema } from '@zenith/shared/ops/maintenance-validation';
import { useMaintenanceAccess, useMaintenanceStatus, useMaintenanceLogs, useMaintenancePlan, useMaintenanceStart, useMaintenanceCancel, useMaintenanceDiagnosis, useUpdateMaintenanceStatus, useMaintenanceRecipients } from '@/hooks/queries/maintenance';
import { ListSearchToolbar } from '@/components/list-page';
import ConfigurableTable from '@/components/ConfigurableTable';
import { useListPage } from '@/hooks/useListPage';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateTimeForApi, parseDateTimeParam } from '@/utils/date';
import DateTimeText from '@/components/DateTimeText';
import './maintenance.css';
import { useLaunchLeaveGuard } from '@/components/workflow/useLaunchLeaveGuard';
const { Text } = Typography;

type Content = { message: string; estimatedEndAt: string | null };
type Draft = Content & { version: number; reason: string; scheduledStartAt: string | null; autoEndAt: string | null; notifyUserIds: number[]; remindMinutes: number };
const format = (value: unknown) => value instanceof Date ? formatDateTimeForApi(value) : null;

function MaintenanceEditor({ status, reload }: { readonly status: MaintenanceStatus; readonly reload: () => unknown }) {
  const access = useMaintenanceAccess();
  const save = useUpdateMaintenanceStatus(); const plan = useMaintenancePlan(); const start = useMaintenanceStart(); const cancel = useMaintenanceCancel();
  const diagnosis = useMaintenanceDiagnosis();
  const [draft, setDraft] = useState<Draft | null>(null);
  useLaunchLeaveGuard(() => draft !== null, true, { title: '放弃未保存的维护配置？', content: '当前修改尚未保存，离开后将丢失。' });
  const [testPath, setTestPath] = useState('/api/users'); const [testMethod, setTestMethod] = useState('GET');
  const [diagnosisKey, setDiagnosisKey] = useState('');
  const [planning, setPlanning] = useState(false);
  const [automaticEnd, setAutomaticEnd] = useState(false);
  const users = useMaintenanceRecipients(planning && !!access.data?.canManage && !status.current);
  const initial: Draft = { message: status.message, estimatedEndAt: status.estimatedEndAt, version: status.version, reason: '', scheduledStartAt: status.scheduledStartAt, autoEndAt: status.autoEndAt, notifyUserIds: status.current?.notifyUserIds ?? [], remindMinutes: status.current?.remindMinutes ?? 15 };
  const value = draft ?? initial; const stale = !!draft && value.version !== status.version;
  const pending = save.isPending || plan.isPending || start.isPending || cancel.isPending;
  const canManage = access.data?.canManage ?? false;
  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...(current ?? initial), ...patch }));
  const abandon = () => {
    const run = () => { setDraft(null); reload(); };
    if (draft) Modal.confirm({ title: '放弃当前草稿并载入最新状态？', onOk: run }); else run();
  };
  const action = async (enabled: boolean) => {
    const parsed = maintenanceContentSchema.safeParse(value);
    if (!parsed.success) { Toast.error(parsed.error.issues[0].message); return; }
    if (!value.reason.trim()) { Toast.error('请填写操作原因'); return; }
    try {
      await save.mutateAsync({ body: { ...parsed.data, autoEndAt: value.autoEndAt, reason: value.reason, enabled, version: value.version } });
      setDraft(null); Toast.success(enabled ? status.enabled ? '维护说明已更新' : '维护已开启' : status.enabled ? '维护已结束' : '草稿已保存');
    } catch { /* Preserve the draft and its original version on all failures. */ }
  };
  const submit = (enabled: boolean) => {
    if (enabled !== status.enabled) Modal.confirm({ title: enabled ? '确认开启业务入口维护？' : '确认结束维护并开放业务？',
      content: enabled ? '普通业务入口将暂停；后台任务、关键支付回调仍运行。当前有管理权限的身份可以恢复管理。' : '结束后普通业务接口和页面恢复访问，后台数据将重新校准。',
      okText: enabled ? '开启维护' : '结束维护', onOk: () => action(enabled) });
    else void action(enabled);
  };
  const submitPlan = async () => {
    if (automaticEnd && !value.autoEndAt) { Toast.error('请选择自动恢复时间'); return; }
    const parsed = maintenancePlanSchema.safeParse({ ...value, autoEndAt: automaticEnd ? value.autoEndAt : null });
    if (!parsed.success) { Toast.error(parsed.error.issues[0].message); return; }
    try { await plan.mutateAsync({ body: parsed.data }); setDraft(null); setPlanning(false); Toast.success('维护计划已安排'); } catch { /* Keep draft. */ }
  };
  const planAction = (name: 'start' | 'cancel') => {
    if (!value.reason.trim()) { Toast.error('请填写操作原因'); return; }
    Modal.confirm({ title: name === 'start' ? '提前开始维护？' : '取消维护计划？', onOk: async () => {
      try { await (name === 'start' ? start : cancel).mutateAsync({ body: { version: value.version, reason: value.reason } }); setDraft(null); } catch { /* Keep draft. */ }
    } });
  };
  const key = status.version + ':' + testMethod + ':' + testPath;
  return <div className="maintenance-editor">
    <Space wrap><Tag color={status.enabled ? 'orange' : status.current ? 'blue' : 'green'}>{status.enabled ? '维护中' : status.current ? '待开始' : '正常开放'}</Tag>
      <Tag>版本 {status.version}</Tag><Button size="small" disabled={pending} onClick={abandon}>{draft ? '放弃草稿并重载' : '刷新状态'}</Button></Space>
    <Descriptions align="left" row column={2} data={[
      { key: '实际开始', value: <DateTimeText value={status.startedAt} mode="absolute" /> },
      { key: '开启人', value: status.startedByName ?? '—' },
      { key: '预计结束', value: <DateTimeText value={status.estimatedEndAt} mode="absolute" /> },
      { key: '自动恢复', value: status.autoEndAt ? <DateTimeText value={status.autoEndAt} mode="absolute" /> : '关闭；预计时间到达不会自动开放' },
      { key: '最后变更', value: <DateTimeText value={status.updatedAt} /> },
    ]} />
    <Text type="tertiary">维护控制 API 与实时业务入口；后台任务、支付结果回调、已有 HTTP 请求可能继续执行，不提供数据库停写保证。</Text>
    {stale ? <Banner type="warning" closeIcon={null} description="服务端状态已变化，当前草稿保留。请重载后重新编辑，旧版本不能提交。" /> : null}
    <label>维护提示<TextArea aria-label="维护提示" rows={3} maxLength={512} value={value.message} onChange={(message) => edit({ message })} disabled={!canManage || pending || status.current?.status === 'scheduled'} /></label>
    <label>预计结束时间<DatePicker type="dateTime" value={parseDateTimeParam(value.estimatedEndAt) ?? undefined} onChange={(date) => edit({ estimatedEndAt: format(date) })} disabled={!canManage || pending || status.current?.status === 'scheduled'} /></label>
    {status.enabled ? <label>自动恢复时间（清空即关闭）<DatePicker type="dateTime" value={parseDateTimeParam(value.autoEndAt) ?? undefined} onChange={(date) => edit({ autoEndAt: format(date) })} disabled={!canManage || pending} /></label> : null}
    {canManage ? <label>操作原因<Input aria-label="操作原因" value={value.reason} maxLength={500} onChange={(reason) => edit({ reason })} disabled={pending} placeholder="保存、开启、延长或结束维护的原因" /></label> : null}
    {status.current?.status === 'scheduled' ? <Space wrap>
      <Text>计划开始：<DateTimeText value={status.scheduledStartAt} mode="absolute" /></Text>
      {canManage ? <><Button disabled={pending || stale} onClick={() => planAction('start')}>提前开始</Button><Button disabled={pending || stale} onClick={() => planAction('cancel')}>取消计划</Button></> : null}
    </Space> : canManage ? <Space wrap>
      <Button theme="solid" loading={pending} disabled={!draft || stale} onClick={() => submit(status.enabled)}>{status.enabled ? '保存维护说明 / 延长' : '保存提示草稿'}</Button>
      <Button type={status.enabled ? 'primary' : 'warning'} disabled={pending || stale} onClick={() => submit(!status.enabled)}>{status.enabled ? '结束维护' : '立即开启维护'}</Button>
      {!status.enabled ? <Button disabled={pending} onClick={() => setPlanning(!planning)}>{planning ? '收起计划' : '安排计划维护'}</Button> : null}
    </Space> : null}
    {planning && !status.current ? <section className="maintenance-plan">
      <label>计划开始<DatePicker type="dateTime" value={parseDateTimeParam(value.scheduledStartAt) ?? undefined} onChange={(date) => edit({ scheduledStartAt: format(date) })} /></label>
      <Space wrap><Text>自动恢复（独立于预计结束）</Text><Switch checked={automaticEnd} onChange={(enabled) => { setAutomaticEnd(enabled); edit({ autoEndAt: enabled ? value.estimatedEndAt : null }); }} /></Space>
      {automaticEnd ? <label>自动恢复时间<DatePicker type="dateTime" value={parseDateTimeParam(value.autoEndAt) ?? undefined} onChange={(date) => edit({ autoEndAt: format(date) })} /></label> : null}
      <label>额外通知接收人（创建人始终接收）<Select multiple maxTagCount={2} value={value.notifyUserIds} optionList={(users.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))} onChange={(ids) => edit({ notifyUserIds: ids as number[] })} placeholder="选择平台用户；通知按渠道策略与个人偏好投递" /></label>
      <Text type="tertiary">由 Worker 每分钟扫描；预计结束只用于展示，只有显式设置自动恢复才会开放。</Text>
      <label>提前提醒（分钟）<InputNumber value={value.remindMinutes} min={0} max={1440} onChange={(minutes) => edit({ remindMinutes: Number(minutes) })} /></label>
      <Button disabled={stale || pending} loading={plan.isPending} onClick={() => void submitPlan()}>提交维护计划</Button>
    </section> : null}
    <Collapse>
      <Collapse.Panel header="访问诊断与影响范围" itemKey="diagnosis" reCalcKey={String(diagnosis.submittedAt) + ':' + diagnosis.isPending}>
        <Space wrap><Select value={testMethod} optionList={['GET','POST','PUT','PATCH','DELETE'].map((method) => ({ value: method, label: method }))} onChange={(method) => setTestMethod(String(method))} style={{ width: 110 }} />
          <Input aria-label="诊断接口路径" value={testPath} onChange={setTestPath} style={{ width: 300 }} />
          <Button loading={diagnosis.isPending} onClick={async () => { try { await diagnosis.mutateAsync({ body: { method: testMethod, path: testPath, version: status.version } }); setDiagnosisKey(key); } catch { /* Request feedback. */ } }}>诊断当前身份</Button></Space>
        {diagnosis.data ? <div>{diagnosisKey !== key ? <Text type="warning">输入或版本已变化，请重新诊断</Text> : <><Tag color={diagnosis.data.allowed ? 'green' : 'red'}>{diagnosis.data.allowed ? '允许通过维护门禁' : '维护拒绝'}</Tag><Text>{diagnosis.data.reason}</Text></>}
          <p>{diagnosis.data.boundaries.join('；')}</p>{diagnosis.data.exceptions.map((item) => <div key={item.method + item.path}><Text type="tertiary">{item.method} {item.path} · {item.reason}</Text></div>)}</div> : null}
      </Collapse.Panel>
      <Collapse.Panel header="管理员恢复说明" itemKey="recovery"><Text>维护页可由具有管理权限的合法账号进入，业务通行需要独立权限。无法进入时，在服务器部署目录执行受控维护恢复命令；不会公开任何 HTTP 绕过入口。</Text></Collapse.Panel>
    </Collapse>
  </div>;
}
function MaintenanceHistory() {
  const page = useListPage({ op: maintenanceContract.logs, useList: useMaintenanceLogs });
  const [detail, setDetail] = useState<MaintenanceLog | null>(null);
  const columns: ColumnProps<MaintenanceLog>[] = [
    dateTimeColumn('计划开始','scheduledStartAt'), dateTimeColumn('实际开始','startedAt'), dateTimeColumn('结束时间','endedAt'),
    { title: '维护提示', dataIndex: 'message', render: renderEllipsis },
    { title: '状态', dataIndex: 'status', width: 110, render: (value) => MAINTENANCE_LOG_STATUS_OPTIONS.find((item) => item.value === value)?.label },
    { title: '开启人', dataIndex: 'startedByName', width: 120 },
    createOperationColumn({ width: 80, actions: (row) => [{ key: 'detail', label: '详情', onClick: () => setDetail(row) }] }),
  ];
  return <><ListSearchToolbar page={page} filters={['keyword','status',['startTime','endTime']]} /><ConfigurableTable columns={columns} {...page.tableProps} />
    <SideSheet title="维护详情" visible={!!detail} onCancel={() => setDetail(null)} width="min(680px, 100vw)">{detail ? <>
      <Descriptions data={[{ key: '原因', value: detail.reason },{ key: '结束原因', value: detail.endReason ?? '—' },{ key: '提示', value: detail.message }]} />
      {detail.changes.map((change, index) => <div key={index} style={{ marginTop: 16, overflowWrap: 'anywhere' }}><Text strong>{MAINTENANCE_ACTION_LABELS[change.action] ?? change.action} · {change.actor}</Text><div><DateTimeText value={change.at} mode="absolute" /> · {change.reason}</div><Text type="tertiary">{change.message}</Text><div>预计结束：<DateTimeText value={change.estimatedEndAt} mode="absolute" />；自动恢复：<DateTimeText value={change.autoEndAt} mode="absolute" /></div></div>)}
    </> : null}</SideSheet></>;
}
export default function MaintenancePage() {
  const access = useMaintenanceAccess();
  const status = useMaintenanceStatus(!!access.data?.canView);
  const [tab, setTab] = useUrlTabState(['config','logs'] as const,'config');
  if (access.isLoading || (access.data?.canView && status.isLoading)) return <Spin size="large" />;
  if (!access.data?.canView && access.data?.canViewLogs) return <div className="page-container"><MaintenanceHistory /></div>;
  if (!access.data?.canView && !access.isError) return <Banner type="warning" description="没有维护查看权限" />;
  if (!status.data) return <Banner type="danger" description={<Space>无法读取维护状态，不能将未知状态视为正常运行<Button onClick={() => void status.refetch()}>重试</Button></Space>} />;
  return <div className="page-container page-tabs-page"><Tabs activeKey={tab} onChange={(value) => setTab(value as typeof tab)} type="line">
    <TabPane itemKey="config" tab="维护控制">{status.isError ? <Banner type="warning" closeIcon={null} description="刷新失败，当前显示上次成功读取的状态；草稿已保留，请重试刷新。" /> : null}<MaintenanceEditor status={status.data} reload={() => status.refetch()} /></TabPane>
    {access.data?.canViewLogs ? <TabPane itemKey="logs" tab="维护记录"><MaintenanceHistory /></TabPane> : null}
  </Tabs></div>;
}

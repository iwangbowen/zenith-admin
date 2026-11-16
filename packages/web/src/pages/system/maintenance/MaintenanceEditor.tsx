import { useState } from 'react';
import { Banner, Button, Collapse, DatePicker, Descriptions, Input, InputNumber, Modal, Select, SideSheet, Space, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { MaintenanceStatus } from '@zenith/shared/ops';
import { maintenanceActionSchema, maintenancePlanSchema, updateMaintenanceSchema } from '@zenith/shared/ops/maintenance-validation';
import { useMaintenanceAccess, useMaintenancePlan, useMaintenanceStart, useMaintenanceCancel, useMaintenanceDiagnosis, useUpdateMaintenanceStatus, useMaintenanceRecipients } from '@/hooks/queries/maintenance';
import { toUserOptions } from '@/hooks/queries/users';
import { AppModal } from '@/components/AppModal';
import { ModalFooter } from '@/components/ModalFooter';
import DateTimeText from '@/components/DateTimeText';
import { useLaunchLeaveGuard } from '@/components/workflow/useLaunchLeaveGuard';
import { formatDateTimeForApi, parseDateTimeParam } from '@/utils/date';

const { Text, Title } = Typography;
type Draft = {
  message: string;
  estimatedEndAt: string | null;
  version: number;
  reason: string;
  scheduledStartAt: string | null;
  autoEndAt: string | null;
  notifyUserIds: number[];
  remindMinutes: number;
};
type Action = { kind: 'save'; enabled: boolean } | { kind: 'start' | 'cancel' };
type Panel = 'plan' | 'diagnosis' | 'help' | 'details';
const format = (value: unknown) => value instanceof Date ? formatDateTimeForApi(value) : null;
const diagnosisMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => ({ value: method, label: method }));

export default function MaintenanceEditor({ status, reload, refreshing }: {
  readonly status: MaintenanceStatus;
  readonly reload: () => unknown;
  readonly refreshing: boolean;
}) {
  const access = useMaintenanceAccess();
  const save = useUpdateMaintenanceStatus();
  const plan = useMaintenancePlan();
  const start = useMaintenanceStart();
  const cancel = useMaintenanceCancel();
  const diagnosis = useMaintenanceDiagnosis();
  // 全局配置和生命周期操作共用带版本的草稿，关闭弹层不丢稿，不适用 CRUD useEditModal。
  const [draft, setDraft] = useState<Draft | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [testPath, setTestPath] = useState('/api/users');
  const [testMethod, setTestMethod] = useState('GET');
  const [diagnosisKey, setDiagnosisKey] = useState('');
  useLaunchLeaveGuard(() => draft !== null, true, {
    title: '放弃未保存的维护配置？', content: '当前修改尚未保存，离开后将丢失。',
  });
  const canManage = access.data?.canManage ?? false;
  const scheduled = status.current?.status === 'scheduled';
  const pending = save.isPending || plan.isPending || start.isPending || cancel.isPending;
  const users = useMaintenanceRecipients(panel === 'plan' && canManage && !status.current);
  const initial: Draft = {
    message: status.message, estimatedEndAt: status.estimatedEndAt, version: status.version, reason: '',
    scheduledStartAt: status.scheduledStartAt, autoEndAt: status.autoEndAt,
    notifyUserIds: status.current?.notifyUserIds ?? [], remindMinutes: status.current?.remindMinutes ?? 15,
  };
  const value = draft ?? initial;
  const stale = !!draft && value.version !== status.version;
  const blocked = pending || stale || !canManage;
  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...(current ?? initial), ...patch }));
  const abandon = () => {
    const run = () => { setDraft(null); setAction(null); setPanel(null); reload(); };
    if (draft) Modal.confirm({ title: '放弃当前草稿并载入最新状态？', closeOnEsc: true, onOk: run });
    else run();
  };
  const openAction = (next: Action) => { edit({}); setAction(next); };
  const closeAction = () => { if (!pending) setAction(null); };
  const closePlan = () => { if (!pending) setPanel(null); };
  const submitAction = async () => {
    if (!action || blocked) return;
    if (!value.reason.trim()) { Toast.error('请填写操作原因'); return; }
    if (action.kind === 'save') {
      const parsed = updateMaintenanceSchema.safeParse({ ...value, enabled: action.enabled });
      if (!parsed.success) { Toast.error(parsed.error.issues[0].message); return; }
      try {
        await save.mutateAsync({ body: parsed.data });
        Toast.success(action.enabled ? status.enabled ? '维护配置已更新' : '维护已开启' : status.enabled ? '维护已结束' : '提示已保存');
        setDraft(null); setAction(null);
      } catch { /* Preserve the draft and original version on failure. */ }
    } else {
      const parsed = maintenanceActionSchema.safeParse(value);
      if (!parsed.success) { Toast.error(parsed.error.issues[0].message); return; }
      try {
        await (action.kind === 'start' ? start : cancel).mutateAsync({ body: parsed.data });
        Toast.success(action.kind === 'start' ? '维护已开始' : '维护计划已取消');
        setDraft(null); setAction(null);
      } catch { /* Keep draft. */ }
    }
  };
  const submitPlan = async () => {
    if (blocked || status.current) return;
    if (!value.scheduledStartAt) { Toast.error('请选择计划开始时间'); return; }
    if (!value.reason.trim()) { Toast.error('请填写操作原因'); return; }
    const parsed = maintenancePlanSchema.safeParse(value);
    if (!parsed.success) { Toast.error(parsed.error.issues[0].message); return; }
    try {
      await plan.mutateAsync({ body: parsed.data });
      setDraft(null); setPanel(null); Toast.success('维护计划已安排');
    } catch { /* Keep draft. */ }
  };
  const key = status.version + ':' + testMethod + ':' + testPath;
  const staleNotice = stale ? <Banner type="warning" closeIcon={null} description="服务端状态已变化，当前草稿保留。请重载最新状态后重新编辑。" /> : null;
  const actionTitle = action?.kind === 'start' ? '提前开始维护' : action?.kind === 'cancel' ? '取消维护计划'
    : action?.kind === 'save' && action.enabled !== status.enabled ? action.enabled ? '确认开启维护' : '确认结束维护' : '保存维护配置';
  const actionDescription = action?.kind === 'start' || (action?.kind === 'save' && action.enabled && !status.enabled)
    ? '确认后普通业务入口暂停。后台任务、关键支付回调及已有请求可能继续运行。'
    : action?.kind === 'cancel' ? '取消后不会按原计划开始维护。'
    : action?.kind === 'save' && !action.enabled && status.enabled ? '确认后普通业务接口和页面恢复访问。'
    : status.enabled ? '本次修改将写入维护记录，系统继续保持维护中。' : '仅保存提示配置，不会开启维护。';

  return <div className="maintenance-editor">
    <header className="maintenance-summary">
      <Space wrap spacing={12}>
        <Tag color={status.enabled ? 'orange' : scheduled ? 'blue' : 'green'}>{status.enabled ? '维护中' : scheduled ? '待开始' : '正常开放'}</Tag>
        <Text type="tertiary" size="small">
          {status.enabled ? <><DateTimeText value={status.startedAt} mode="absolute" /> 开始{status.startedByName ? ' · ' + status.startedByName : ''}</>
            : scheduled ? <>计划于 <DateTimeText value={status.scheduledStartAt} mode="absolute" /> 开始</> : '当前没有维护计划'}
        </Text>
      </Space>
      <Button theme="borderless" size="small" loading={refreshing} disabled={pending} onClick={abandon}>{draft ? '放弃草稿并重载' : '刷新状态'}</Button>
    </header>
    {staleNotice}
    {scheduled ? <section className="maintenance-config">
      <Title heading={6}>当前维护计划</Title>
      <Descriptions align="left" column={1} data={[
        { key: '维护提示', value: status.message },
        { key: '计划开始', value: <DateTimeText value={status.scheduledStartAt} mode="absolute" /> },
        { key: '预计结束', value: status.estimatedEndAt ? <DateTimeText value={status.estimatedEndAt} mode="absolute" /> : '未设置' },
        { key: '自动恢复', value: status.autoEndAt ? <DateTimeText value={status.autoEndAt} mode="absolute" /> : '未设置，需手动结束' },
      ]} />
      {canManage ? <Space wrap className="maintenance-actions">
        <Button disabled={blocked} onClick={() => openAction({ kind: 'cancel' })}>取消计划</Button>
        <Button theme="solid" disabled={blocked} onClick={() => openAction({ kind: 'start' })}>提前开始</Button>
      </Space> : null}
    </section> : <section className="maintenance-config">
      <Title heading={6}>维护配置</Title>
      <label className="maintenance-field">维护提示
        <TextArea aria-label="维护提示" rows={3} maxLength={512} value={value.message} onChange={(message) => edit({ message })} disabled={!canManage || pending} />
      </label>
      <label className="maintenance-field maintenance-date">预计结束时间
        <DatePicker type="dateTime" aria-label="预计结束时间" value={parseDateTimeParam(value.estimatedEndAt) ?? undefined} onChange={(date) => edit({ estimatedEndAt: format(date) })} disabled={!canManage || pending} />
        <Text type="tertiary" size="small">选填，仅向用户展示，不会自动结束维护。</Text>
      </label>
      {status.enabled ? <label className="maintenance-field maintenance-date">自动恢复时间
        <DatePicker type="dateTime" aria-label="自动恢复时间" value={parseDateTimeParam(value.autoEndAt) ?? undefined} onChange={(date) => edit({ autoEndAt: format(date) })} disabled={!canManage || pending} />
        <Text type="tertiary" size="small">不设置时，由管理员手动结束维护。</Text>
      </label> : null}
      {canManage ? <Space wrap className="maintenance-actions">
        <Button disabled={!draft || blocked} onClick={() => openAction({ kind: 'save', enabled: status.enabled })}>{status.enabled ? '保存修改' : '保存提示'}</Button>
        {!status.enabled ? <Button disabled={pending || stale} onClick={() => { edit({}); setPanel('plan'); }}>安排计划</Button> : null}
        <Button theme="solid" disabled={blocked} onClick={() => openAction({ kind: 'save', enabled: !status.enabled })}>{status.enabled ? '结束维护' : '立即开启维护'}</Button>
      </Space> : null}
    </section>}
    <footer className="maintenance-help">
      <Text type="tertiary" size="small">维护期间，普通用户无法访问业务入口。</Text>
      <Space wrap spacing={16}>
        <Button theme="borderless" size="small" onClick={() => setPanel('diagnosis')}>访问诊断</Button>
        <Button theme="borderless" size="small" onClick={() => setPanel('help')}>维护说明</Button>
        <Button theme="borderless" size="small" onClick={() => setPanel('details')}>状态详情</Button>
      </Space>
    </footer>
    <AppModal title={actionTitle} visible={!!action} width={480} onCancel={closeAction}
      footer={<ModalFooter onCancel={closeAction} onOk={submitAction} loading={pending} disabled={blocked} okText={actionTitle.replace('确认', '')} />}>
      <div className="maintenance-dialog">
        {staleNotice}
        <Text type="secondary">{actionDescription}</Text>
        <label className="maintenance-field">操作原因<TextArea aria-label="操作原因" rows={3} maxLength={500} value={value.reason} onChange={(reason) => edit({ reason })} disabled={pending} placeholder="填写本次操作的原因，用于记录与审计" /></label>
      </div>
    </AppModal>
    <SideSheet title="安排计划维护" visible={panel === 'plan'} width={560} closeOnEsc
      onCancel={closePlan}
      footer={<ModalFooter onCancel={closePlan} onOk={submitPlan} loading={plan.isPending} disabled={blocked || !!status.current} okText="安排计划" />}>
      <div className="maintenance-dialog">
        {staleNotice}
        <label className="maintenance-field">维护提示<TextArea aria-label="计划维护提示" rows={3} maxLength={512} value={value.message} onChange={(message) => edit({ message })} disabled={pending} /></label>
        <label className="maintenance-field">计划开始<DatePicker type="dateTime" aria-label="计划开始" value={parseDateTimeParam(value.scheduledStartAt) ?? undefined} onChange={(date) => edit({ scheduledStartAt: format(date) })} disabled={pending} /></label>
        <label className="maintenance-field">预计结束时间<DatePicker type="dateTime" aria-label="计划预计结束时间" value={parseDateTimeParam(value.estimatedEndAt) ?? undefined} onChange={(date) => edit({ estimatedEndAt: format(date) })} disabled={pending} /><Text type="tertiary" size="small">选填，仅用于展示，不会自动恢复。</Text></label>
        <label className="maintenance-field">自动恢复时间<DatePicker type="dateTime" aria-label="计划自动恢复时间" value={parseDateTimeParam(value.autoEndAt) ?? undefined} onChange={(date) => edit({ autoEndAt: format(date) })} disabled={pending} /><Text type="tertiary" size="small">选填，不设置则需手动结束维护。</Text></label>
        <Collapse><Collapse.Panel header={value.remindMinutes ? '通知设置 · 提前 ' + value.remindMinutes + ' 分钟提醒' : '通知设置 · 不提前提醒'} itemKey="notifications" reCalcKey={users.data?.length}>
          <div className="maintenance-dialog">
            <Text type="tertiary" size="small">创建人始终接收，通知按渠道策略与个人偏好投递。</Text>
            <label className="maintenance-field">额外接收人<Select aria-label="额外接收人" multiple maxTagCount={2} showRestTagsPopover filter value={value.notifyUserIds} loading={users.isLoading} optionList={toUserOptions(users.data ?? [])} onChange={(ids) => edit({ notifyUserIds: ids as number[] })} placeholder="选择平台用户" disabled={pending} /></label>
            <label className="maintenance-field">提前提醒（分钟）<InputNumber aria-label="提前提醒分钟" value={value.remindMinutes} min={0} max={1440} onChange={(minutes) => edit({ remindMinutes: Number(minutes) })} disabled={pending} /><Text type="tertiary" size="small">设为 0 关闭提前提醒。</Text></label>
          </div>
        </Collapse.Panel></Collapse>
        <label className="maintenance-field">操作原因<TextArea aria-label="计划操作原因" rows={2} maxLength={500} value={value.reason} onChange={(reason) => edit({ reason })} disabled={pending} placeholder="填写计划维护的原因" /></label>
        <Text type="tertiary" size="small">计划由 Worker 每分钟推进，请确认系统调度正常运行。</Text>
      </div>
    </SideSheet>
    <SideSheet title={panel === 'diagnosis' ? '访问诊断' : panel === 'details' ? '状态详情' : '维护说明'} visible={!!panel && panel !== 'plan'} width={640} closeOnEsc onCancel={() => setPanel(null)}>
      {panel === 'diagnosis' ? <div className="maintenance-dialog">
        <Text type="secondary">诊断当前身份能否通过维护门禁，业务接口仍会执行自身权限与安全校验。</Text>
        <div className="maintenance-diagnosis-inputs">
          <Select aria-label="请求方法" value={testMethod} optionList={diagnosisMethods} onChange={(method) => setTestMethod(String(method))} className="maintenance-method" />
          <Input aria-label="诊断接口路径" value={testPath} onChange={setTestPath} className="maintenance-path" />
          <Button loading={diagnosis.isPending} onClick={async () => { try { await diagnosis.mutateAsync({ body: { method: testMethod, path: testPath, version: status.version } }); setDiagnosisKey(key); } catch { /* Request feedback. */ } }}>诊断当前身份</Button>
        </div>
        {diagnosis.data ? <div className="maintenance-dialog">
          {diagnosisKey !== key ? <Text type="warning">输入或版本已变化，请重新诊断</Text> : <Space wrap><Tag color={diagnosis.data.allowed ? 'green' : 'red'}>{diagnosis.data.allowed ? '允许通过维护门禁' : '维护拒绝'}</Tag><Text>{diagnosis.data.reason}</Text></Space>}
          <Text type="secondary">{diagnosis.data.boundaries.join('；')}</Text>
          <Collapse><Collapse.Panel header="门禁例外范围" itemKey="exceptions" reCalcKey={diagnosis.submittedAt}>
            {diagnosis.data.exceptions.map((item) => <div key={item.method + item.path} className="maintenance-exception"><Text>{item.method} {item.path}</Text><Text type="tertiary" size="small">{item.reason}</Text></div>)}
          </Collapse.Panel></Collapse>
        </div> : null}
      </div> : panel === 'details' ? <Descriptions align="left" column={1} data={[
        { key: '配置版本', value: status.version }, { key: '最后变更', value: <DateTimeText value={status.updatedAt} mode="absolute" /> },
        ...(status.current ? [
          { key: '计划开始', value: <DateTimeText value={status.scheduledStartAt} mode="absolute" /> },
          { key: '实际开始', value: <DateTimeText value={status.startedAt} mode="absolute" /> },
          { key: '开启人', value: status.startedByName ?? '—' },
          { key: '预计结束', value: <DateTimeText value={status.estimatedEndAt} mode="absolute" /> },
          { key: '自动恢复', value: status.autoEndAt ? <DateTimeText value={status.autoEndAt} mode="absolute" /> : '未设置，需手动结束' },
        ] : []),
      ]} /> : panel === 'help' ? <div className="maintenance-dialog">
        <Title heading={6}>维护范围</Title><Text>维护控制 API 与实时业务入口。后台任务、支付结果回调、已有 HTTP 请求可能继续执行，不提供数据库停写保证。</Text>
        <Title heading={6}>恢复时间</Title><Text>预计结束时间仅用于展示；只有显式设置自动恢复时间才会自动开放。计划与自动恢复由 Worker 每分钟推进。</Text>
        <Title heading={6}>管理员恢复</Title><Text>具有维护管理权限的合法账号可以进入恢复控制台，业务通行需要独立权限。无法进入页面时，在服务器部署目录执行受控维护恢复命令。</Text>
        <Text code copyable>npm run maintenance:recover -- --actor-id &lt;平台管理员ID&gt; --reason "维护完成，恢复服务" --confirm-disable</Text>
        <Text type="tertiary" size="small">monorepo 根目录执行时加 -w @zenith/server；源码开发环境使用 maintenance:recover:dev。命令校验当前账号及管理权限并记录原因。</Text>
      </div> : null}
    </SideSheet>
  </div>;
}

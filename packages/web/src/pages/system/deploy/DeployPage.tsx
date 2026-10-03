import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Descriptions, Divider, Form, Modal, SideSheet, Spin, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { DEPLOY_HEALTH_CHECK_TYPE_OPTIONS, DEPLOY_RESTART_MODE_OPTIONS, DEPLOY_RUN_KIND_LABELS, DEPLOY_RUN_STATUS_LABELS, DEPLOY_RUN_STATUSES, DEPLOY_STRATEGY_OPTIONS, type AppRelease, type ClientApp, type DeployRelease, type DeployRun, type DeployTarget, type DeployTargetHost, type DeployRunKind, type CreateDeployTargetInput } from '@zenith/shared/ops';
import { deployRunContract, deployReleaseContract } from '@zenith/shared/ops';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { SearchToolbar } from '@/components/SearchToolbar';
import { EditFormSheet } from '@/components/EditFormModal';
import { useEditModal } from '@/hooks/useEditModal';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { useListPage } from '@/hooks/useListPage';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useAllClientApps, useAppReleaseList } from '@/hooks/queries/app-releases';
import { useOpsHosts } from '@/hooks/queries/ops-hosts';
import { useCreateDeployRun, useDeleteDeployTarget, useDeployReleaseList, useDeployRunDetail, useDeployRunList, useDeployRunLogs, useDeployTargetList, useSaveDeployTarget, useSyncDeployTarget, deployKeys } from '@/hooks/queries/deploy';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { enumValueOf, formatBytes } from '@zenith/shared/core';
import { useSearchParams } from 'react-router-dom';
import './DeployPage.css';

const { Text } = Typography;
const RUN_COLORS: Record<DeployRun['status'], 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'grey'> = { pending: 'blue', running: 'cyan', succeeded: 'green', partial: 'orange', failed: 'red', cancelled: 'grey' };
function runStatus(status: DeployRun['status']) { return <Tag color={RUN_COLORS[status]} size="small">{DEPLOY_RUN_STATUS_LABELS[status]}</Tag>; }
function targetValues(values: Partial<CreateDeployTargetInput> & { sharedPathsText?: string }) {
  const { sharedPathsText, ...rest } = values;
  return { ...rest, sharedPaths: (sharedPathsText ?? '').split(/[,\n]/).map((v) => v.trim()).filter(Boolean) } as CreateDeployTargetInput;
}

function TargetFields({ apps, hosts }: { apps: ClientApp[]; hosts: Array<{ id: number; name: string; enabled: boolean }> }) {
  return <>
    <Divider align="left">基本信息</Divider>
    <Form.Select field="appId" label="服务端应用" placeholder="选择服务端应用" style={{ width: '100%' }} optionList={apps.filter((a) => a.kind === 'service').map((a) => ({ value: a.id, label: a.name }))} rules={[{ required: true, message: '请选择服务端应用' }]} />
    <Form.Input field="name" label="部署环境" placeholder="生产 / 预发" rules={[{ required: true, message: '请输入名称' }]} />
    <Form.Select field="hostIds" label="目标主机" placeholder="选择目标主机，可多选" style={{ width: '100%' }} multiple optionList={hosts.filter((h) => h.enabled).map((h) => ({ value: h.id, label: h.name }))} rules={[{ required: true, message: '至少选择一台主机' }]} />
    <Form.Input field="deployPath" label="部署根目录" placeholder="/opt/apps/order-svc" rules={[{ required: true, message: '请输入绝对路径' }]} />

    <Divider align="left">发布策略</Divider>
    <Form.TextArea field="sharedPathsText" label="持久化路径" placeholder={'每行一个，例如：\nlogs\nconfig/application.yml'} rows={3} />
    <div className="auto-grid deploy-target-grid">
      <Form.InputNumber field="keepReleases" label="保留版本数" style={{ width: '100%' }} min={1} max={50} />
      <Form.Select field="restartMode" label="重启方式" style={{ width: '100%' }} optionList={DEPLOY_RESTART_MODE_OPTIONS} />
      <Form.Input field="serviceName" label="systemd 单元名" placeholder="systemd 模式必填" />
      <Form.Select field="strategy" label="多主机策略" style={{ width: '100%' }} optionList={DEPLOY_STRATEGY_OPTIONS} />
      <Form.InputNumber field="maxParallel" label="最大并行数" style={{ width: '100%' }} min={1} max={20} />
    </div>
    <Form.Switch field="autoRollback" label="失败自动回滚" extraText="健康检查失败时切回上一版并重启" />
    <Form.Switch field="stopOnFailure" label="失败即停止" extraText="滚动发布时，首台失败后停止后续主机" />

    <Divider align="left">健康检查</Divider>
    <Form.Select field="healthCheck.type" label="检查方式" style={{ width: '100%' }} placeholder="选择健康检查方式" optionList={DEPLOY_HEALTH_CHECK_TYPE_OPTIONS} />
    <Form.Input field="healthCheck.url" label="HTTP 地址" placeholder="HTTP 探活地址" />
    <Form.InputNumber field="healthCheck.port" label="TCP 端口" min={1} max={65535} />
    <Form.TextArea field="healthCheck.command" label="命令检查" placeholder="退出码 0 表示健康" rows={2} />
    <Form.TextArea field="remark" label="备注" rows={2} maxCount={500} />
  </>;
}

function TargetTab({ active, onDeploy }: { active: boolean; onDeploy: (target: DeployTarget) => void }) {
  const { hasPermission } = usePermission(); const apps = useAllClientApps(active).data ?? []; const hosts = useOpsHosts(active).data ?? []; const query = useDeployTargetList({}, active); const save = useSaveDeployTarget(); const remove = useDeleteDeployTarget(); const sync = useSyncDeployTarget();
  const modal = useEditModal<DeployTarget, Partial<CreateDeployTargetInput> & { sharedPathsText?: string }>({ entityName: '部署目标', save, defaults: { restartMode: 'systemd', strategy: 'rolling', maxParallel: 2, keepReleases: 5, autoRollback: true, stopOnFailure: true, sharedPathsText: '' }, toValues: (r) => ({ appId: r.appId, name: r.name, description: r.description ?? '', hostIds: r.hosts.map((h) => h.hostId), deployPath: r.deployPath, sharedPaths: r.sharedPaths, keepReleases: r.keepReleases, restartMode: r.restartMode, serviceName: r.serviceName ?? undefined, scripts: r.scripts, healthCheck: r.healthCheck, env: r.env, autoRollback: r.autoRollback, strategy: r.strategy, maxParallel: r.maxParallel, stopOnFailure: r.stopOnFailure, enabled: r.enabled, remark: r.remark ?? '', sharedPathsText: r.sharedPaths.join('\n') }), beforeSave: targetValues });
  const columns: ColumnProps<DeployTarget>[] = [
    { title: '目标名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis }, { title: '应用', dataIndex: 'appName', width: 140, render: renderEllipsis },
    { title: '主机', dataIndex: 'hosts', width: 170, render: (v: DeployTargetHost[]) => v.map((h) => h.hostName).join('、') || EMPTY_PLACEHOLDER },
    { title: '当前版本', dataIndex: 'hosts', width: 120, render: (v: DeployTargetHost[]) => v.map((h) => h.currentVersion ?? '—').join('、') || EMPTY_PLACEHOLDER },
    { title: '重启', dataIndex: 'restartMode', width: 100, render: (v) => v === 'systemd' ? 'systemd' : v === 'script' ? '脚本' : '无需重启' },
    { title: '最近部署', dataIndex: 'lastRun', width: 110, render: (v: DeployTarget['lastRun']) => v ? runStatus(v.status) : EMPTY_PLACEHOLDER }, dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<DeployTarget>({ width: 260, desktopInlineKeys: ['deploy', 'edit', 'sync'], actions: (r) => [
      { key: 'deploy', label: '部署', hidden: !hasPermission('system:deploy:execute'), onClick: () => onDeploy(r) }, { key: 'edit', label: '编辑', hidden: !hasPermission('system:deploy:manage'), onClick: () => modal.openEdit(r) }, { key: 'sync', label: '对账', hidden: !hasPermission('system:deploy:execute'), loading: sync.isPending, onClick: () => void sync.mutateAsync({ params: { id: r.id } }) }, deleteAction({ hidden: !hasPermission('system:deploy:manage'), title: `确定删除部署目标「${r.name}」吗？`, run: () => remove.mutateAsync({ params: { id: r.id } }) }),
    ]}),
  ];
  return <>
    <SearchToolbar primary={<RefreshButton onClick={() => void query.refetch()} loading={query.isFetching} />} actions={<CreateButton permission="system:deploy:manage" onClick={modal.openCreate}>新增部署目标</CreateButton>} /><ConfigurableTable columns={columns} dataSource={query.data ?? []} loading={query.isLoading} onRefresh={() => void query.refetch()} refreshLoading={query.isFetching} empty="暂无部署目标，请先创建服务端应用" /><EditFormSheet modal={modal} width={780} formProps={{ labelWidth: 140 }}><TargetFields apps={apps} hosts={hosts} /></EditFormSheet></>;
}

function DeployModal({ target, release, onClose }: { target: DeployTarget | null; release?: AppRelease | null; onClose: () => void }) {
  const formApi = useRef<FormApi | null>(null); const create = useCreateDeployRun(); const releases = useAppReleaseList({ appId: target?.appId ?? 0, page: 1, pageSize: 100, status: 'published' }, target != null && release == null); const options = release ? [release] : (releases.data?.list ?? []);
  return <Modal title={`部署到 ${target?.name ?? ''}`} visible={target != null} onCancel={onClose} closeOnEsc width={560} footer={null}><Form getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={100} initValues={{ releaseId: release?.id }}><Form.Select field="releaseId" label="发布版本" optionList={options.map((r) => ({ value: r.id, label: `v${r.version}` }))} disabled={release != null} rules={[{ required: true, message: '请选择版本' }]} /><Form.TextArea field="remark" label="备注" rows={2} /><div className="deploy-modal-footer"><Button theme="borderless" onClick={onClose}>取消</Button><Button theme="solid" type="primary" loading={create.isPending} onClick={async () => { const values = await formApi.current?.validate() as { releaseId: number; remark?: string }; if (!target) return; await create.mutateAsync({ body: { kind: 'deploy', targetId: target.id, releaseId: values.releaseId, remark: values.remark } }); Toast.success('部署任务已提交'); onClose(); }}>提交部署</Button></div></Form></Modal>;
}

function RunDetail({ runId, onClose }: { runId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (runId == null) return undefined;
    const onRunUpdate = (event: Event) => {
      const payload = (event as CustomEvent<{ runId?: number }>).detail;
      if (payload?.runId === runId) {
        void qc.invalidateQueries({ queryKey: deployKeys.run(runId) });
        void qc.invalidateQueries({ queryKey: deployKeys.logs(runId, { afterSeq: 0, limit: 2000 }) });
      }
    };
    globalThis.addEventListener('deploy:run-updated', onRunUpdate);
    globalThis.addEventListener('deploy:log', onRunUpdate);
    return () => { globalThis.removeEventListener('deploy:run-updated', onRunUpdate); globalThis.removeEventListener('deploy:log', onRunUpdate); };
  }, [qc, runId]);
  const run = useDeployRunDetail(runId ?? undefined, runId != null).data; const logs = useDeployRunLogs(runId ?? undefined, { afterSeq: 0, limit: 2000 }, runId != null).data ?? [];
  return <SideSheet title={run ? `部署记录 #${run.id} · ${run.appName ?? ''} ${run.version ? `v${run.version}` : ''}` : '部署记录详情'} visible={runId != null} onCancel={onClose} width={880} closeOnEsc><Spin spinning={!run}>{run && <><Descriptions row size="small" style={{ marginBottom: 16 }} data={[{ key: '状态', value: runStatus(run.status) }, { key: '类型', value: DEPLOY_RUN_KIND_LABELS[run.kind] }, { key: '目标', value: run.targetName ?? run.targetId }, { key: 'release', value: run.releaseName ?? EMPTY_PLACEHOLDER }, { key: '结果', value: `${run.hostSucceeded}/${run.hostTotal} 台成功` }, { key: '错误', value: run.error ?? EMPTY_PLACEHOLDER }]} /><Card title="主机状态" style={{ marginBottom: 12 }}>{run.hosts?.map((h) => <div key={h.id} className="deploy-host-line"><Text strong>{h.hostName}</Text><Tag color={h.status === 'succeeded' ? 'green' : h.status === 'rolled_back' ? 'orange' : h.status === 'failed' ? 'red' : 'blue'} size="small">{h.status}</Tag><Text type="tertiary">{h.step ?? '—'} · {h.releaseName ?? '—'}</Text>{h.error && <Text type="danger">{h.error}</Text>}</div>)}</Card><Card title="部署日志" bodyStyle={{ padding: 0 }}><pre className="deploy-log-console">{logs.map((l) => `[${l.createdAt}] ${l.level.toUpperCase()} ${l.step ? `[${l.step}] ` : ''}${l.line}`).join('\n') || '暂无日志'}</pre></Card></>}</Spin></SideSheet>;
}

function RunsTab({ onOpen }: { active: boolean; onOpen: (id: number) => void }) {
  const page = useListPage({ contract: deployRunContract, useList: useDeployRunList, table: { rowKey: 'id', empty: '暂无部署记录' } });
  useListDeepLink(['run', 'release', 'status'], (picked) => {
    if (picked.run) onOpen(Number(picked.run));
    if (picked.release || picked.status) page.applySearch({
      releaseId: picked.release ? Number(picked.release) : undefined,
      status: enumValueOf(DEPLOY_RUN_STATUSES, picked.status),
    });
  });
  const columns: ColumnProps<DeployRun>[] = [{ title: '记录', dataIndex: 'id', width: 80 }, { title: '应用', dataIndex: 'appName', minWidth: 150, render: renderEllipsis }, { title: '目标', dataIndex: 'targetName', width: 120 }, { title: '类型', dataIndex: 'kind', width: 90, render: (v: DeployRunKind) => DEPLOY_RUN_KIND_LABELS[v] }, { title: '版本', dataIndex: 'version', width: 100, render: (v) => v ?? EMPTY_PLACEHOLDER }, { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: runStatus }, { title: '进度', dataIndex: 'hostSucceeded', width: 110, render: (_v, r) => `${r.hostSucceeded}/${r.hostTotal} 成功` }, dateTimeColumn('发起时间', 'createdAt'), createOperationColumn<DeployRun>({ width: 110, actions: (r) => [{ key: 'detail', label: '详情', onClick: () => onOpen(r.id) }] })];
  return <><ListSearchToolbar page={page} filters={['appId', 'targetId', 'releaseId', 'kind', 'status', 'keyword', ['startTime', 'endTime']]} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={columns} {...page.tableProps} /></>;
}

function ReleasesTab({ onRollback }: { active: boolean; onRollback: (r: DeployRelease) => void }) {
  const page = useListPage({ contract: deployReleaseContract, useList: useDeployReleaseList, table: { rowKey: 'id', empty: '暂无发布备份' } });
  const columns: ColumnProps<DeployRelease>[] = [{ title: '应用', dataIndex: 'appName', minWidth: 150, render: renderEllipsis }, { title: '目标', dataIndex: 'targetName', width: 110 }, { title: '主机', dataIndex: 'hostName', width: 140, render: renderEllipsis }, { title: '版本', dataIndex: 'version', width: 100 }, { title: 'release 目录', dataIndex: 'releaseName', minWidth: 220, render: renderEllipsis }, { title: '大小', dataIndex: 'sizeBytes', width: 110, render: (v: number | null) => v == null ? EMPTY_PLACEHOLDER : formatBytes(v) }, { title: '运行中', dataIndex: 'isCurrent', width: 90, render: (v: boolean) => v ? <Tag color="green">current</Tag> : EMPTY_PLACEHOLDER }, dateTimeColumn('创建时间', 'createdAt'), createOperationColumn<DeployRelease>({ width: 120, actions: (r) => [{ key: 'rollback', label: '回滚', danger: true, disabled: r.isCurrent, onClick: () => onRollback(r) }] })];
  return <><ListSearchToolbar page={page} filters={['appId', 'targetId', 'hostId', 'keyword', 'includeRemoved']} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={columns} {...page.tableProps} /></>;
}

export default function DeployPage() {
  const [searchParams] = useSearchParams();
  const defaultTab = enumValueOf(DEPLOY_RUN_STATUSES, searchParams.get('status')) ? 'records' : 'targets';
  const [activeTab, setActiveTab] = useUrlTabState(['targets', 'records', 'releases'] as const, defaultTab); const [runId, setRunId] = useState<number | null>(null); const [target, setTarget] = useState<DeployTarget | null>(null); const [release, setRelease] = useState<AppRelease | null>(null); const create = useCreateDeployRun(); const qc = useQueryClient();
  const handleRollback = (r: DeployRelease) => { if (r.isCurrent) return; Modal.confirm({ title: `确认回滚到 v${r.version}？`, content: `目标：${r.targetName ?? r.targetId} / 主机：${r.hostName ?? r.hostId}`, onOk: async () => { await create.mutateAsync({ body: { kind: 'rollback', targetId: r.targetId, releaseName: r.releaseName } }); Toast.success('回滚任务已提交'); void qc.invalidateQueries({ queryKey: deployKeys.runs }); } }); };
  return <div className="page-container page-tabs-page zx-flat-panels"><Tabs collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} type="line" lazyRender keepDOM={false}><TabPane tab="部署目标" itemKey="targets"><TargetTab active={activeTab === 'targets'} onDeploy={setTarget} /></TabPane><TabPane tab="部署记录" itemKey="records"><RunsTab active={activeTab === 'records'} onOpen={setRunId} /></TabPane><TabPane tab="发布备份" itemKey="releases"><ReleasesTab active={activeTab === 'releases'} onRollback={handleRollback} /></TabPane></Tabs><DeployModal target={target} release={release} onClose={() => { setTarget(null); setRelease(null); }} /><RunDetail runId={runId} onClose={() => setRunId(null)} /></div>;
}

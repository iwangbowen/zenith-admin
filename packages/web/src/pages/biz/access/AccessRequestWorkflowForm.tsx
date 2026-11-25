import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { Banner, Button, Descriptions, Form, Space, Spin, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { createLabelOptionsFromMap, stableStringify, type BodyOf } from '@zenith/shared/core';
import {
  ACCESS_APPROVAL_POLICY_LABELS, ACCESS_REQUEST_TYPE_LABELS, ACCESS_RISK_LABELS, ACCESS_START_MODE_LABELS, ACCESS_VALIDITY_MODE_LABELS,
  accessApprovalPlanSchema, higherAccessRisk, stricterAccessApproval,
  accessGovernanceContract,
  accessSourceLabel, accessSourceRefSchema,
  type AccessApprovalPolicy, type AccessRiskLevel, type AccessWorkflowInput, type AccessWorkflowOptions,
} from '@zenith/shared/identity';
import DateTimeText from '@/components/DateTimeText';
import { DATA_SCOPE_OPTIONS } from '@/components/permissions/DataScopePanel';
import { PermissionScopeDrawer } from '@/components/permissions/PermissionScopeDrawer';
import { createAccessScopeData } from '@/components/permissions/scope-adapters';
import type { PermissionScopeValue } from '@/components/permissions/scope-types';
import type { WorkflowBusinessFormApi, WorkflowBusinessFormProps } from '@/components/workflow/BusinessFormHost';
import { useAccessWorkflowOptions, useAccessWorkflowPreview } from '@/hooks/queries/identity-access-governance';
import { abortSubmit } from '@/lib/abort-submit';
import { formatDateTimeForApi, parseDateTimeParam } from '@/utils/date';
import { singleLineColumns } from '@/utils/table-columns';
import AccessWorkflowResult from './AccessWorkflowResult';

const { Text } = Typography;
const TYPE_OPTIONS = createLabelOptionsFromMap(ACCESS_REQUEST_TYPE_LABELS);
const START_OPTIONS = createLabelOptionsFromMap(ACCESS_START_MODE_LABELS);
const VALIDITY_OPTIONS = createLabelOptionsFromMap(ACCESS_VALIDITY_MODE_LABELS);
const RISK_COLORS = { low: 'green', high: 'orange', critical: 'red' } as const;
type PickerDate = Date | string | null;
type FormValues = Omit<AccessWorkflowInput, 'startsAt' | 'expiresAt' | 'roleSelections'> & { roleIds: number[]; startsAt?: PickerDate; expiresAt: PickerDate };

function pickerTime(value: PickerDate | undefined): number | undefined {
  return value instanceof Date ? value.getTime() : typeof value === 'string' ? parseDateTimeParam(value)?.getTime() : undefined;
}

function initialValues(value: Record<string, unknown>): FormValues {
  return {
    requestType: value.requestType === 'emergency' ? 'emergency' : 'temporary',
    startMode: value.startMode === 'scheduled' ? 'scheduled' : 'immediate',
    validityMode: value.validityMode === 'permanent' ? 'permanent' : 'limited',
    roleIds: Array.isArray(value.roleSelections) ? (value.roleSelections as AccessWorkflowInput['roleSelections']).map(role => role.roleId) : [],
    permissionCodes: Array.isArray(value.permissionCodes) ? value.permissionCodes as string[] : [],
    menuIds: Array.isArray(value.menuIds) ? value.menuIds as number[] : [],
    startsAt: typeof value.startsAt === 'string' ? parseDateTimeParam(value.startsAt) : null,
    expiresAt: typeof value.expiresAt === 'string' ? parseDateTimeParam(value.expiresAt) : new Date(Date.now() + 480 * 60_000),
    reason: typeof value.reason === 'string' ? value.reason : '',
  };
}

function serialize(values: FormValues, roles: AccessWorkflowOptions['roles']): BodyOf<typeof accessGovernanceContract.workflowPreview> {
  const { roleIds, previewFingerprint: _fingerprint, ...input } = values;
  return { ...input, roleSelections: roleIds.map(roleId => ({ roleId, version: roles.find(role => role.id === roleId)?.version ?? 0 })), startsAt: values.startMode === 'scheduled' ? formatDateTimeForApi(values.startsAt) : undefined, expiresAt: values.validityMode === 'permanent' ? null : formatDateTimeForApi(values.expiresAt) };
}

function ReadonlyAccessRequest({ value }: Readonly<{ value: Record<string, unknown> }>) {
  const risk = typeof value.riskLevel === 'string' && value.riskLevel in ACCESS_RISK_LABELS ? value.riskLevel as AccessRiskLevel : null;
  const items = Array.isArray(value.permissionItems) ? value.permissionItems as Array<Record<string, unknown>> : [];
  const pages = Array.isArray(value.menus) ? value.menus as Array<Record<string, unknown>> : [];
  const plan = accessApprovalPlanSchema.safeParse(value.approvalPlan);
  return <div>
    <Descriptions column={2} align="plain" data={[
      { key: '受益人', value: String(value.targetUserName ?? value.targetUserId ?? '当前用户') },
      { key: '申请类型', value: ACCESS_REQUEST_TYPE_LABELS[value.requestType === 'emergency' ? 'emergency' : 'temporary'] },
      { key: '风险等级', value: risk ? <Tag color={RISK_COLORS[risk]}>{ACCESS_RISK_LABELS[risk]}</Tag> : '提交后计算' },
      { key: '生效时间', value: <DateTimeText value={String(value.startsAt ?? '')} mode="absolute" /> },
      { key: '失效时间', value: <DateTimeText value={String(value.expiresAt ?? '')} empty="永久有效" mode="absolute" /> },
      { key: '审批要求', value: plan.success ? `${ACCESS_APPROVAL_POLICY_LABELS[plan.data.approvalPolicy]}${plan.data.mfaRequired ? '；每名审批人均需验证 MFA' : ''}` : '—', span: 2 },
      { key: '申请原因', value: <Text style={{ whiteSpace: 'pre-wrap' }}>{String(value.reason ?? '—')}</Text>, span: 2 },
    ]} />
    {plan.success && plan.data.steps.length > 0 && <div style={{ margin: '16px 0' }}><Text strong>实际审批计划</Text><div style={{ marginTop: 8 }}>{plan.data.steps.map(step => `${step.label}：${step.userName}`).join(' → ')}</div></div>}
    {pages.length > 0 && <div style={{ marginTop: 16 }}>
      <Text strong>页面访问</Text>
      <Table dataSource={pages.map((page, index) => ({ ...page, key: index }))} rowKey="key" pagination={false} size="small" columns={singleLineColumns([
        { title: '页面', dataIndex: 'title' },
        { title: '路径', dataIndex: 'path', render: (path: unknown) => String(path ?? '—') },
      ])} />
    </div>}
    <Table dataSource={items.map((item, index) => ({ ...item, key: index }))} rowKey="key" pagination={false} size="small" empty="暂无权限项" columns={singleLineColumns([
      { title: '权限名称', dataIndex: 'permissionLabel', render: (label: unknown, row: Record<string, unknown>) => String(label ?? row.permissionCode ?? '—') },
      { title: '权限码', dataIndex: 'permissionCode' },
      { title: '数据范围', render: (_: unknown, row: Record<string, unknown>) => DATA_SCOPE_OPTIONS.find(option => option.value === row.dataScope)?.label ?? '—' },
      { title: '来源', render: (_: unknown, row: Record<string, unknown>) => { const sources = accessSourceRefSchema.array().safeParse(row.sourceRefs); return sources.success ? accessSourceLabel(sources.data) : '—'; } },
    ])} />
  </div>;
}

export default function AccessRequestWorkflowForm({ mode, value, instanceId, bizId, requestClient, getFormApi, onValuesChange }: Readonly<WorkflowBusinessFormProps>) {
  const optionsQuery = useAccessWorkflowOptions(mode === 'create', requestClient);
  const formApi = useRef<FormApi | null>(null);
  const [defaults] = useState(() => initialValues(value));
  const [values, setValues] = useState(defaults);
  const menuIdsRef = useRef<number[]>(defaults.menuIds ?? []);
  const permissionCodesRef = useRef<string[]>(defaults.permissionCodes ?? []);
  const [scopeVisible, setScopeVisible] = useState(false);
  const roles = optionsQuery.data?.roles ?? [];
  const menus = useMemo(() => optionsQuery.data?.menus ?? [], [optionsQuery.data?.menus]);
  const scopeData = useMemo(() => createAccessScopeData(optionsQuery.data?.menus ?? []), [optionsQuery.data?.menus]);
  const pageTitleById = useMemo(() => new Map(menus.map(menu => [menu.id, menu.title])), [menus]);
  const permissionLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const menu of menus) {
      if (menu.permission) map.set(menu.permission, menu.permissionLabel ?? menu.title);
    }
    return map;
  }, [menus]);
  const selectedPageTitles = values.menuIds.map(id => pageTitleById.get(id) ?? `#${id}`);
  const selectedPermissionLabels = values.permissionCodes.map(code => permissionLabelByCode.get(code) ?? code);
  const selectedRoles = roles.filter(role => values.roleIds.includes(role.id));
  const coveredPermissionCodes = useMemo(() => [...new Set((optionsQuery.data?.roles ?? []).filter(role => values.roleIds.includes(role.id)).flatMap(role => role.permissionCodes))], [optionsQuery.data?.roles, values.roleIds]);
  const selectedMenus = menus.filter(menu => !!menu.permission
    && (values.permissionCodes.includes(menu.permission) || values.menuIds.includes(menu.id))
    && menu.requestable);
  const selection = [...selectedRoles, ...selectedMenus];
  const risk = selection.reduce<AccessRiskLevel>((level, item) => higherAccessRisk(level, item.riskLevel), 'low');
  const approval = selection.reduce<AccessApprovalPolicy>((policy, item) => stricterAccessApproval(policy, item.approvalPolicy), 'none');
  const durationLimits = selection.flatMap(item => item.maxDurationMinutes === null ? [] : [item.maxDurationMinutes]);
  const permanentAllowed = selection.length > 0 && selection.every(item => item.permanentAllowed);
  const emergencyAllowed = selection.length > 0 && selection.every(item => item.emergencyAllowed);
  if (values.requestType === 'emergency') durationLimits.push(...selection.map(item => item.maxEmergencyMinutes));
  const maxMinutes = durationLimits.length ? Math.min(...durationLimits) : null;
  const mfaRequired = selection.some(item => item.mfaRequired);
  const startTimestamp = values.startMode === 'scheduled' ? pickerTime(values.startsAt) : undefined;
  const previewInput = useMemo(() => ({ ...serialize(values, optionsQuery.data?.roles ?? []), reason: '' }), [values, optionsQuery.data]);
  const [debouncedPreviewInput] = useDebouncedValue(previewInput, { wait: 350 });
  const previewQuery = useAccessWorkflowPreview(debouncedPreviewInput, mode === 'create' && optionsQuery.isSuccess, requestClient);
  const previewPending = previewQuery.isFetching || stableStringify(previewInput) !== stableStringify(debouncedPreviewInput);
  const preview = previewPending ? undefined : previewQuery.data;
  const latestPreview = useRef({ preview, previewInput, roles, maxMinutes });
  latestPreview.current = { preview, previewInput, roles, maxMinutes };

  useEffect(() => {
    const api = formApi.current;
    if (!api || maxMinutes === null || values.validityMode === 'permanent') return;
    const expiry = pickerTime(api.getValue('expiresAt') as PickerDate | undefined);
    const limit = (startTimestamp ?? Date.now()) + maxMinutes * 60_000;
    if (expiry !== undefined && expiry > limit) api.setValue('expiresAt', new Date(limit));
  }, [maxMinutes, startTimestamp, values.validityMode]);

  if (mode !== 'create') return <><ReadonlyAccessRequest value={value} />{instanceId && bizId ? <AccessWorkflowResult instanceId={instanceId} requestClient={requestClient} /> : null}</>;
  if (optionsQuery.isLoading) return <Spin />;
  if (optionsQuery.error) return <Banner type="warning" closeIcon={null} description={optionsQuery.error.message} />;

  const registerApi = (api: FormApi) => {
    formApi.current = api;
    const withPicked = (current: FormValues): FormValues => ({ ...current, menuIds: menuIdsRef.current, permissionCodes: permissionCodesRef.current });
    getFormApi?.({
      isPreviewReady: () => { const current = withPicked(api.getValues() as FormValues); return !!(current.roleIds?.length || current.permissionCodes?.length || current.menuIds?.length); },
      getValues: () => serialize(withPicked(api.getValues() as FormValues), latestPreview.current.roles),
      validate: async () => {
        const current = withPicked(await api.validate() as FormValues);
        const fail = (message: string): never => { Toast.warning(message); return abortSubmit('invalid_access_request'); };
        const { preview: evaluated, roles: currentRoles, maxMinutes: currentLimit } = latestPreview.current;
        if (!(current.roleIds?.length || current.permissionCodes?.length || current.menuIds?.length)) fail('请选择至少一项页面、角色或操作权限');
        if (current.roleIds.some(id => !currentRoles.some(role => role.id === id)) || current.permissionCodes.some(code => !menus.some(menu => menu.permission === code && menu.requestable))) fail('所选角色或权限已不可申请，请重新选择');
        const start = (current.startMode === 'scheduled' ? pickerTime(current.startsAt) : Date.now()) ?? Number.NaN;
        const end = pickerTime(current.expiresAt) ?? Number.NaN;
        if (!start || (current.startMode === 'scheduled' && start <= Date.now())) fail('请选择晚于当前时间的预约生效时间');
        if (current.validityMode === 'limited') {
          if (!end || end <= start) fail('失效时间必须晚于生效时间和当前时间');
          if (currentLimit !== null && end - start > currentLimit * 60_000) fail(`本次限时申请最长有效 ${currentLimit} 分钟，请调整失效时间`);
        }
        const serialized = serialize(current, currentRoles);
        if (!evaluated || stableStringify({ ...serialized, reason: '' }) !== stableStringify(latestPreview.current.previewInput)) return fail('正在更新权限预览，请确认最新结果后提交');
        if (evaluated.status !== 'ready') return fail(evaluated.message);
        return { ...serialized, previewFingerprint: evaluated.fingerprint };
      },
    } satisfies WorkflowBusinessFormApi);
  };

  const openScope = () => setScopeVisible(true);
  const closeScope = () => setScopeVisible(false);
  const applyScope = (next: PermissionScopeValue) => {
    menuIdsRef.current = next.pageIds;
    permissionCodesRef.current = next.permissionCodes;
    formApi.current?.setValue('menuIds', next.pageIds);
    formApi.current?.setValue('permissionCodes', next.permissionCodes);
    setValues(prev => ({ ...prev, menuIds: next.pageIds, permissionCodes: next.permissionCodes }));
    setScopeVisible(false);
  };
  return <><Form getFormApi={registerApi} initValues={defaults} onValueChange={next => { setValues(next as FormValues); onValuesChange?.(); }} labelPosition="left" labelWidth={110} style={{ width: '100%' }}>
    <Form.RadioGroup field="requestType" name="access-request-type" label="申请类型" options={TYPE_OPTIONS.map(option => ({ ...option, disabled: option.value === 'emergency' && !emergencyAllowed }))} type="button"
      extraText={values.requestType === 'emergency' ? '用于故障处置等紧急任务，将以紧急授权留痕；仍须按所选权限风险完成全部审批与 MFA 验证。' : '用于日常业务任务，可选择限时或永久有效；审批链由所选权限中最严格的策略决定。'} />
    <Form.Select field="roleIds" label="申请角色包" multiple filter showClear style={{ width: '100%' }}
      maxTagCount={2} showRestTagsPopover
      optionList={roles.map(role => ({ value: role.id, label: `${role.name} · ${role.permissionCount} 项 · ${ACCESS_RISK_LABELS[role.riskLevel]}` }))} placeholder="可选，按需申请完整角色权限包"
      extraText="角色包按角色配置的数据范围授权。只需要少量权限时，优先在下方逐项选择。" />
    <Form.Slot label={{ text: '授权范围' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap spacing={6}>
            <Typography.Text strong>已选授权</Typography.Text>
            <Tag color="blue" size="small">页面 {values.menuIds.length}</Tag>
            <Tag color="green" size="small">操作权限 {values.permissionCodes.length}</Tag>
            {values.roleIds.length > 0 && <Tag size="small">角色包 {values.roleIds.length}</Tag>}
            {coveredPermissionCodes.length > 0 && <Typography.Text type="tertiary" size="small">角色覆盖 {coveredPermissionCodes.length} 项</Typography.Text>}
          </Space>
          <Button type="primary" theme="light" htmlType="button" onClick={openScope}>
            {values.menuIds.length || values.permissionCodes.length ? '编辑授权范围' : '选择授权范围'}
          </Button>
        </div>
        {selectedPageTitles.length > 0 || selectedPermissionLabels.length > 0 ? (
          <div style={{ display: 'grid', gap: 4, marginTop: 8, minWidth: 0 }}>
            {selectedPageTitles.length > 0 && (
              <div title={selectedPageTitles.join('、')} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Typography.Text type="tertiary" size="small">页面：</Typography.Text>
                <Typography.Text size="small">{selectedPageTitles.join('、')}</Typography.Text>
              </div>
            )}
            {selectedPermissionLabels.length > 0 && (
              <div title={selectedPermissionLabels.join('、')} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Typography.Text type="tertiary" size="small">操作权限：</Typography.Text>
                <Typography.Text size="small">{selectedPermissionLabels.join('、')}</Typography.Text>
              </div>
            )}
          </div>
        ) : (
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>尚未选择页面访问或操作权限</Typography.Text>
        )}
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
          页面访问负责导航并自动携带页面读权限；操作权限独立授予，不会隐藏或带出页面。
        </Typography.Text>
      </div>
    </Form.Slot>
    <Form.RadioGroup field="startMode" name="access-start-mode" label="生效方式" options={START_OPTIONS} />
    {values.startMode === 'scheduled' && <Form.DatePicker field="startsAt" label="生效时间" type="dateTime" format="yyyy-MM-dd HH:mm:ss" style={{ width: '100%' }} rules={[{ required: true, message: '请选择预约生效时间' }]} />}
    <Form.RadioGroup field="validityMode" name="access-validity-mode" label="有效期限" options={VALIDITY_OPTIONS.map(option => ({ ...option, disabled: option.value === 'permanent' && (!permanentAllowed || values.requestType === 'emergency') }))} extraText={values.validityMode === 'permanent' ? '无需填写截止时间。授权仍可撤销，并按权限策略定期复核。' : !permanentAllowed && selection.length > 0 ? '所选权限仅支持限时授权。' : undefined} />
    {values.validityMode !== 'permanent' && <Form.DatePicker field="expiresAt" label="失效时间" type="dateTime" format="yyyy-MM-dd HH:mm:ss" style={{ width: '100%' }} rules={[{ required: true, message: '请选择失效时间' }]}
      extraText={maxMinutes === null ? '请按业务需要选择截止时间。实际权限在审批和发放完成后可用。' : `本次限时授权最长 ${maxMinutes} 分钟。实际权限在审批和发放完成后可用。`} />}
    <Form.TextArea field="reason" label="申请原因" maxCount={1000} rows={4} rules={[{ required: true, message: '请填写申请原因' }, { min: 5, message: '申请原因至少 5 个字' }]} placeholder="说明业务任务、必要权限及使用范围，便于审批人判断" />
    {previewPending && <Spin tip="正在计算权限与审批计划" />}
    {previewQuery.error && <Banner type="warning" closeIcon={null} description={previewQuery.error.message} />}
    {preview && preview.status !== 'ready' && <Banner type={preview.status === 'blocked' ? 'warning' : 'info'} closeIcon={null} description={preview.message} />}
    {selection.length > 0 && <section aria-label="提交前确认" style={{ margin: '16px 0', padding: 12, backgroundColor: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)' }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>提交前确认</Text>
      {preview?.status === 'ready' && <div style={{ marginBottom: 8 }}>
        <Text>{preview.menuCount} 个页面 · {preview.permissionCount} 项权限 · {preview.grantItemCount} 条授权范围</Text>
        <div><Text>{preview.approvalPlan.steps.length ? preview.approvalPlan.steps.map(step => `${step.label}：${step.userName}`).join(' → ') : '当前策略免人工审批，提交后自动发放'}</Text></div>
      </div>}
      <Space wrap><Tag color={RISK_COLORS[risk]}>{ACCESS_RISK_LABELS[risk]}</Tag><Text>{ACCESS_APPROVAL_POLICY_LABELS[approval]}</Text><Text>{values.validityMode === 'permanent' ? '永久有效' : '限时有效'}</Text>{mfaRequired && <Tag color="orange">审批需 MFA</Tag>}</Space>
      {selectedRoles.length > 0 && <div style={{ marginTop: 8 }}><Text type="tertiary" size="small">角色数据范围：</Text><Space wrap>{selectedRoles.map(role => <Tag key={role.id}>{role.name}：{DATA_SCOPE_OPTIONS.find(option => option.value === role.dataScope)?.label ?? '—'}</Tag>)}</Space></div>}
      <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>实际审批人见右侧审批预览。授权可撤销，并按权限策略定期复核。</Text>
    </section>}
    <Text type="tertiary" size="small">风险、审批人与授权范围以服务端校验结果为准。直接申请的操作权限默认仅作用于本人数据。</Text>
  </Form>
  <PermissionScopeDrawer
    visible={scopeVisible}
    data={scopeData}
    initialValue={{ pageIds: menuIdsRef.current, permissionCodes: permissionCodesRef.current }}
    coveredPermissionCodes={coveredPermissionCodes}
    loading={optionsQuery.isLoading}
    onCancel={closeScope}
    onApply={applyScope}
  />
  </>;
}

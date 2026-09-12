import { useMemo, useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { ArrayField, Button, Form, SideSheet, Spin, TabPane, Tabs, Tag, Toast, Typography, useFormState, withField } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import UserSelect from '@/components/UserSelect';
import { EMPTY_PLACEHOLDER, createdAtColumn, dateTimeColumn, renderEllipsis, enabledStatusColumn } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import { usePagination } from '@/hooks/usePagination';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useDictItems } from '@/hooks/useDictItems';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { USER_STATUSES, enumValueOf, getByPath } from '@zenith/shared/core';
import {
  IOT_AUTOMATION_ACTION_TYPE_LABELS, IOT_AUTOMATION_ACTION_TYPE_OPTIONS,
  IOT_AUTOMATION_DEFAULT_COOLDOWN_SECONDS, IOT_AUTOMATION_ACTION_MAX,
  IOT_AUTOMATION_TARGET_OPTIONS, IOT_AUTOMATION_TRIGGERS, IOT_AUTOMATION_TRIGGER_LABELS, IOT_AUTOMATION_TRIGGER_OPTIONS,
  IOT_COMPARE_OP_LABELS,
} from '@zenith/shared/iot';
import type { CreateIotAutomationInput, IotAutomation, IotAutomationAction, IotAutomationRun } from '@zenith/shared/iot';
import { IotDeviceSelectField, IotProductSelectField, useIotDeviceOptions, useIotGroupOptions } from './components/IotSelectors';
import { IotSuccessTag } from './components/IotStatus';
import { IotEventSelectField, IotPropertyConditionFields, useIotThingModelSelects } from './components/ThingModelFields';
import { jsonObjectToText, parseJsonObjectInput } from './iot-form-utils';
import { usePublishedWorkflowDefinitions } from '@/hooks/queries/workflow-definitions';
import {
  iotAutomationKeys, useDeleteIotAutomations, useIotAutomationList,
  useIotAutomationRunList, useSaveIotAutomation,
} from '@/hooks/queries/iot-automations';

const { Text } = Typography;

const FormUserSelect = withField(UserSelect);

/** 触发条件摘要（列表列 + 执行记录侧栏共用） */
function describeTrigger(r: IotAutomation): string {
  if (r.triggerType === 'property') {
    return `${r.propertyIdentifier} ${r.operator ? IOT_COMPARE_OP_LABELS[r.operator] : ''} ${r.threshold}`;
  }
  if (r.triggerType === 'event') return `上报事件 ${r.eventIdentifier}`;
  return IOT_AUTOMATION_TRIGGER_LABELS[r.triggerType];
}

function describeAction(a: IotAutomationAction): string {
  const label = IOT_AUTOMATION_ACTION_TYPE_LABELS[a.type];
  if (a.type === 'command') return `${label}：${a.service ?? ''}`;
  if (a.type === 'desired') return `${label}：${Object.keys(a.desired ?? {}).join('、')}`;
  if (a.type === 'notify') return `${label}：${(a.userIds ?? []).length} 人`;
  return label;
}

// ─── 联动规则 Tab ─────────────────────────────────────────────────────────────
interface AutomationSearchParams {
  keyword: string;
  triggerType?: string;
  status?: string;
}

const defaultSearch: AutomationSearchParams = { keyword: '', triggerType: undefined, status: undefined };

/** 表单值中的动作行（JSON 字段以文本形态编辑，提交时解析） */
interface ActionFormRow {
  type: IotAutomationAction['type'];
  target?: 'self' | 'device' | 'group';
  targetDeviceId?: number | null;
  targetGroupId?: number | null;
  service?: string | null;
  paramsText?: string;
  desiredText?: string;
  userIds?: number[] | null;
  workflowDefinitionId?: number | null;
}

function toActionRow(a: IotAutomationAction): ActionFormRow {
  return {
    type: a.type,
    target: a.target ?? 'self',
    targetDeviceId: a.targetDeviceId ?? null,
    targetGroupId: a.targetGroupId ?? null,
    service: a.service ?? null,
    paramsText: jsonObjectToText(a.params),
    desiredText: jsonObjectToText(a.desired),
    userIds: a.userIds ?? [],
    workflowDefinitionId: a.workflowDefinitionId ?? null,
  };
}

function fromActionRow(row: ActionFormRow): IotAutomationAction {
  const base: IotAutomationAction = { type: row.type };
  if (row.type === 'command' || row.type === 'desired') {
    base.target = row.target ?? 'self';
    if (base.target === 'device') base.targetDeviceId = row.targetDeviceId ?? null;
    if (base.target === 'group') base.targetGroupId = row.targetGroupId ?? null;
  }
  if (row.type === 'command') {
    base.service = row.service ?? null;
    base.params = (parseJsonObjectInput({ text: row.paramsText, label: '服务参数', empty: 'undefined', toast: false, errorMessage: '服务参数 需为 JSON 对象，如 {"power":"on"}' }) as Record<string, string | number | boolean> | undefined) ?? null;
  }
  if (row.type === 'desired') {
    const desired = parseJsonObjectInput({ text: row.desiredText, label: '期望属性', empty: 'undefined', toast: false, errorMessage: '期望属性 需为 JSON 对象，如 {"power":"on"}' }) as Record<string, string | number | boolean> | undefined;
    if (!desired || Object.keys(desired).length === 0) throw new Error('期望属性不能为空');
    base.desired = desired;
  }
  if (row.type === 'notify') {
    if (!row.userIds || row.userIds.length === 0) throw new Error('通知动作需选择接收人');
    base.userIds = row.userIds;
  }
  if (row.type === 'workflow') {
    if (!row.workflowDefinitionId) throw new Error('工作流动作需选择流程定义');
    base.workflowDefinitionId = row.workflowDefinitionId;
  }
  return base;
}

/** 联动表单值：动作以行编辑形态承载（JSON 字段为文本），提交前由 beforeSave 解析为契约动作 */
interface AutomationFormValues extends Partial<Omit<CreateIotAutomationInput, 'actions'>> {
  actions?: ActionFormRow[];
}

function AutomationRulesTab({ onShowRuns }: Readonly<{ onShowRuns: (automation: IotAutomation) => void }>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<AutomationSearchParams>({ defaults: defaultSearch, listKey: iotAutomationKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    triggerType: enumValueOf(IOT_AUTOMATION_TRIGGERS, submittedParams.triggerType),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);
  const listQuery = useIotAutomationList({
    page,
    pageSize,
    ...filterQuery,
  });
  const { items: statusItems } = useDictItems('common_status');

  const modal = useEditModal<IotAutomation, AutomationFormValues, Partial<CreateIotAutomationInput>>({
    entityName: '联动规则',
    save: useSaveIotAutomation(),
    toValues: (r) => ({
      name: r.name,
      productId: r.productId,
      deviceId: r.deviceId,
      triggerType: r.triggerType,
      propertyIdentifier: r.propertyIdentifier,
      operator: r.operator,
      threshold: r.threshold,
      eventIdentifier: r.eventIdentifier,
      decisionRuleKey: r.decisionRuleKey ?? '',
      cooldownSeconds: r.cooldownSeconds,
      actions: r.actions.map(toActionRow),
      status: r.status,
    }),
    defaults: {
      triggerType: 'property',
      cooldownSeconds: IOT_AUTOMATION_DEFAULT_COOLDOWN_SECONDS,
      status: 'enabled',
      actions: [{ type: 'notify', target: 'self', userIds: [] }],
    },
    beforeSave: (values, { isEdit }) => {
      const rows = values.actions ?? [];
      if (rows.length === 0) throw new Error('至少需要一个执行动作');
      let actions: IotAutomationAction[];
      try {
        actions = rows.map(fromActionRow);
      } catch (err) {
        Toast.warning((err as Error).message);
        throw err;
      }
      return {
        name: values.name,
        ...(isEdit ? {} : {
          productId: values.productId,
          triggerType: values.triggerType,
        }),
        deviceId: values.deviceId ?? null,
        propertyIdentifier: values.propertyIdentifier ?? null,
        operator: values.operator ?? null,
        threshold: values.threshold ?? null,
        eventIdentifier: values.eventIdentifier ?? null,
        decisionRuleKey: values.decisionRuleKey?.trim() || null,
        cooldownSeconds: values.cooldownSeconds ?? IOT_AUTOMATION_DEFAULT_COOLDOWN_SECONDS,
        actions,
        status: values.status,
      };
    },
    labelWidth: 110,
  });

  const deleteMutation = useDeleteIotAutomations();

  const columns: ColumnProps<IotAutomation>[] = [
    {
      title: '联动名称', dataIndex: 'name', minWidth: 170,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '触发器', dataIndex: 'triggerType', width: 90,
      render: (v: IotAutomation['triggerType']) => IOT_AUTOMATION_TRIGGER_LABELS[v],
    },
    {
      title: '触发条件', width: 190,
      render: (_: unknown, r: IotAutomation) => renderEllipsis(describeTrigger(r)),
    },
    {
      title: '动作', width: 230,
      render: (_: unknown, r: IotAutomation) => renderEllipsis(r.actions.map(describeAction).join('；')),
    },
    {
      title: '所属产品', dataIndex: 'productName', width: 150,
      render: (v: string | null) => renderEllipsis(v),
    },
    {
      title: '生效范围', dataIndex: 'deviceName', width: 130,
      render: (v: string | null) => v ? renderEllipsis(`仅 ${v}`) : '全部设备',
    },
    {
      title: '冷却', dataIndex: 'cooldownSeconds', width: 80, align: 'right',
      render: (v: number) => `${v}s`,
    },
    {
      title: '近 24h', dataIndex: 'recentRunCount', width: 90, align: 'right',
      render: (v: number, r: IotAutomation) => v > 0
        ? <Button theme="borderless" size="small" onClick={() => onShowRuns(r)}>{v} 次</Button>
        : EMPTY_PLACEHOLDER,
    },
    createdAtColumn,
    enabledStatusColumn(),
    createOperationColumn<IotAutomation>({
      width: 240,
      actions: (record) => [
        { key: 'runs', label: '执行记录', onClick: () => onShowRuns(record) },
        ...(hasPermission('iot:automation:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('iot:automation:delete'),
          title: `确定要删除联动「${record.name}」吗？`,
          content: '执行记录将一并删除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <>
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索联动名称..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={<>
          <FilterSelect
            placeholder="全部触发器"
            items={IOT_AUTOMATION_TRIGGER_OPTIONS}
            {...bind('triggerType')}
            width={140}
          />
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('iot:automation:create')
            ? <CreateButton onClick={modal.openCreate}>新增联动</CreateButton> : null
        )}
        filterTitle="筛选条件"
      />
      <ConfigurableTable<IotAutomation>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无场景联动，点击「新增联动」创建第一条' })}
      />

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.modalProps.visible}
        onCancel={modal.modalProps.onCancel}
        closeOnEsc
        width={720}
        footer={<ModalFooter onCancel={modal.modalProps.onCancel} onOk={() => void modal.modalProps.onOk()} loading={modal.modalProps.okButtonProps.loading} disabled={modal.modalProps.okButtonProps.disabled} />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            {({ formState }) => (
              <AutomationFormBody
                isEdit={modal.isEdit}
                values={formState.values as Record<string, unknown>}
              />
            )}
          </Form>
        </Spin>
      </SideSheet>
    </>
  );
}

/** 联动表单体：触发器（按物模型联想）+ 动作编排（ArrayField） */
function AutomationFormBody({ isEdit, values }: Readonly<{ isEdit: boolean; values: Record<string, unknown> }>) {
  const productId = (values.productId as number | undefined) ?? null;
  const triggerType = (values.triggerType as string | undefined) ?? 'property';
  const { items: devices } = useIotDeviceOptions(productId, productId !== null);
  const { services } = useIotThingModelSelects(productId);

  return (
    <>
      <Form.Input field="name" label="联动名称" placeholder="如：高温自动开启风扇"
        rules={[{ required: true, message: '联动名称不能为空' }]} />
      <IotProductSelectField isEdit={isEdit} />
      <IotDeviceSelectField productId={productId} />
      <Form.RadioGroup field="triggerType" label="触发器" disabled={isEdit}
        extraText={isEdit ? '触发器类型不可变更' : undefined}>
        {IOT_AUTOMATION_TRIGGER_OPTIONS.map((o) => (
          <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
        ))}
      </Form.RadioGroup>

      {triggerType === 'property' && (
        <IotPropertyConditionFields productId={productId} />
      )}
      {triggerType === 'event' && (
        <IotEventSelectField productId={productId} />
      )}

      <ActionsArrayField devices={devices} services={services.map((s) => ({ identifier: s.identifier, name: s.name }))} />

      <Form.InputNumber field="cooldownSeconds" label="冷却期（秒）" min={0} max={86400} style={{ width: 160 }}
        extraText="同一设备触发后在窗口内不重复执行" />
      <Form.Input field="decisionRuleKey" label="决策表 Key" placeholder="规则中心决策表 key（可选）" style={{ width: 220 }}
        extraText="填写后触发时先经决策表判定，命中才执行动作" />
      <FormStatusRadioGroup />
    </>
  );
}

interface ArrayFieldRowApi {
  field: string;
  key: string;
  remove: () => void;
}

/** 动作编排：每行按动作类型条件渲染参数字段 */
function ActionsArrayField({ devices, services }: Readonly<{
  devices: Array<{ id: number; name: string; sn: string }>;
  services: Array<{ identifier: string; name: string }>;
}>) {
  const { items: groups } = useIotGroupOptions();
  const workflowsQuery = usePublishedWorkflowDefinitions();
  const workflows = workflowsQuery.data ?? [];

  return (
    <Form.Slot label="执行动作">
      <ArrayField field="actions">
        {({ add, arrayFields }: { add: () => void; arrayFields: ArrayFieldRowApi[] }) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {arrayFields.map(({ field, key, remove }) => (
              <ActionRow
                key={key}
                field={field}
                onRemove={remove}
                devices={devices}
                services={services}
                groups={groups.map((g) => ({ id: g.id, name: g.name }))}
                workflows={workflows.map((w) => ({ id: w.id, name: w.name }))}
              />
            ))}
            {arrayFields.length < IOT_AUTOMATION_ACTION_MAX && (
              <div>
                <Button icon={<Plus size={14} />} theme="light" size="small" onClick={add}>添加动作</Button>
              </div>
            )}
          </div>
        )}
      </ArrayField>
    </Form.Slot>
  );
}

function ActionRow({ field, onRemove, devices, services, groups, workflows }: Readonly<{
  field: string;
  onRemove: () => void;
  devices: Array<{ id: number; name: string; sn: string }>;
  services: Array<{ identifier: string; name: string }>;
  groups: Array<{ id: number; name: string }>;
  workflows: Array<{ id: number; name: string }>;
}>) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap',
      padding: '8px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)',
    }}>
      <Form.Select field={`${field}[type]`} noLabel style={{ width: 130 }} initValue="notify"
        optionList={IOT_AUTOMATION_ACTION_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      <ActionRowFields field={field} devices={devices} services={services} groups={groups} workflows={workflows} />
      <Button type="danger" theme="borderless" size="small" onClick={onRemove}>删除</Button>
    </div>
  );
}

/** 通过 useFormState 读当前行类型渲染差异字段（Semi ArrayField 内没有行级 values 注入；`field` 形如 actions[0]） */
function ActionRowFields({ field, devices, services, groups, workflows }: Readonly<{
  field: string;
  devices: Array<{ id: number; name: string; sn: string }>;
  services: Array<{ identifier: string; name: string }>;
  groups: Array<{ id: number; name: string }>;
  workflows: Array<{ id: number; name: string }>;
}>) {
  const formState = useFormState();
  const row = (getByPath(formState.values, field) ?? {}) as ActionFormRow;
  const type = row.type ?? 'notify';
  const target = row.target ?? 'self';

  return (
    <>
      {(type === 'command' || type === 'desired') && (
        <>
          <Form.Select field={`${field}[target]`} noLabel style={{ width: 110 }} initValue="self"
            optionList={IOT_AUTOMATION_TARGET_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          {target === 'device' && (
            <Form.Select field={`${field}[targetDeviceId]`} noLabel placeholder="选择设备" style={{ width: 180 }}
              optionList={devices.map((d) => ({ value: d.id, label: `${d.name}（${d.sn}）` }))}
              rules={[{ required: true, message: '必选' }]} />
          )}
          {target === 'group' && (
            <Form.Select field={`${field}[targetGroupId]`} noLabel placeholder="选择分组" style={{ width: 150 }}
              optionList={groups.map((g) => ({ value: g.id, label: g.name }))}
              rules={[{ required: true, message: '必选' }]} />
          )}
        </>
      )}
      {type === 'command' && (
        <>
          <Form.Select field={`${field}[service]`} noLabel placeholder="服务" style={{ width: 150 }}
            optionList={services.map((s) => ({ value: s.identifier, label: `${s.name}（${s.identifier}）` }))}
            rules={[{ required: true, message: '必选' }]}
            emptyContent="该产品物模型没有服务" />
          <Form.Input field={`${field}[paramsText]`} noLabel placeholder='参数 JSON（可空），如 {"speed":2}' style={{ width: 220 }} />
        </>
      )}
      {type === 'desired' && (
        <Form.Input field={`${field}[desiredText]`} noLabel placeholder='期望属性 JSON，如 {"power":"on"}' style={{ width: 340 }}
          rules={[{ required: true, message: '必填' }]} />
      )}
      {type === 'notify' && (
        <div style={{ minWidth: 260, flex: 1 }}>
          <FormUserSelect field={`${field}[userIds]`} noLabel multiple placeholder="选择通知接收人" />
        </div>
      )}
      {type === 'workflow' && (
        <Form.Select field={`${field}[workflowDefinitionId]`} noLabel placeholder="选择流程定义" style={{ width: 240 }}
          optionList={workflows.map((w) => ({ value: w.id, label: w.name }))}
          rules={[{ required: true, message: '必选' }]}
          emptyContent="暂无已发布的流程定义" />
      )}
    </>
  );
}

// ─── 执行记录 Tab ─────────────────────────────────────────────────────────────
function AutomationRunsTab({ filterAutomation, onClearFilter }: Readonly<{
  filterAutomation: IotAutomation | null;
  onClearFilter: () => void;
}>) {
  const { page, pageSize, setPage, buildPagination } = usePagination(10);
  const [successFilter, setSuccessFilter] = useState<string | undefined>();
  const [detailRun, setDetailRun] = useState<IotAutomationRun | null>(null);

  const listQuery = useIotAutomationRunList({
    page,
    pageSize,
    automationId: filterAutomation?.id,
    success: successFilter ? successFilter === 'true' : undefined,
  });
  const columns: ColumnProps<IotAutomationRun>[] = [
    dateTimeColumn<IotAutomationRun>('执行时间', 'createdAt'),
    {
      title: '联动', dataIndex: 'automationName', minWidth: 170,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '触发设备', dataIndex: 'deviceName', width: 150,
      render: (v: string | null) => renderEllipsis(v),
    },
    {
      title: 'SN', dataIndex: 'deviceSn', width: 170,
      render: (v: string | null) => v
        ? <Text type="tertiary" size="small" style={{ whiteSpace: 'nowrap' }}>{v}</Text>
        : EMPTY_PLACEHOLDER,
    },
    {
      title: '动作结果', width: 260,
      render: (_: unknown, r: IotAutomationRun) => renderEllipsis(
        r.results.map((x) => `${x.type}${x.success ? ' ✓' : ' ✗'}`).join('；') || EMPTY_PLACEHOLDER,
      ),
    },
    {
      title: '结果', dataIndex: 'success', width: 80, fixed: 'right',
      render: (v: boolean) => <IotSuccessTag success={v} />,
    },
    createOperationColumn<IotAutomationRun>({
      width: 100,
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setDetailRun(record) },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar
        primary={<>
          {filterAutomation && (
            <Tag closable onClose={onClearFilter} color="blue">
              联动：{filterAutomation.name}
            </Tag>
          )}
          <FilterSelect
            placeholder="全部结果"
            items={[{ value: 'true', label: '成功' }, { value: 'false', label: '失败' }]}
            value={successFilter}
            onChange={(v) => { setSuccessFilter(v); setPage(1); }}
          />
        </>}
      />
      <ConfigurableTable<IotAutomationRun>
        columns={columns}
        {...listTableProps(listQuery, {
          empty: '暂无执行记录',
          pagination: buildPagination,
        })}
      />

      <SideSheet
        title="执行详情"
        visible={detailRun !== null}
        onCancel={() => setDetailRun(null)}
        width={520}
      >
        {detailRun && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Text type="secondary" size="small">触发上下文</Text>
              <pre style={{
                margin: '4px 0 0', padding: 12, borderRadius: 'var(--semi-border-radius-medium)', fontSize: 12,
                background: 'var(--semi-color-fill-0)', overflow: 'auto',
              }}>{JSON.stringify(detailRun.triggerContext, null, 2)}</pre>
            </div>
            <div>
              <Text type="secondary" size="small">动作结果</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {detailRun.results.map((r, i) => (
                  <div key={`${r.type}-${i}`} style={{
                    padding: '8px 12px', borderRadius: 'var(--semi-border-radius-medium)',
                    background: 'var(--semi-color-fill-0)',
                    display: 'flex', gap: 8, alignItems: 'baseline',
                  }}>
                    <IotSuccessTag success={r.success} />
                    <Text size="small" strong>{r.type}{r.target ? ` → ${r.target}` : ''}</Text>
                    {r.message && <Text size="small" type="tertiary">{r.message}</Text>}
                  </div>
                ))}
                {detailRun.results.length === 0 && <Text size="small" type="tertiary">无动作结果</Text>}
              </div>
            </div>
          </div>
        )}
      </SideSheet>
    </>
  );
}

// ─── 页面 ─────────────────────────────────────────────────────────────────────
const AUTOMATION_TABS = ['rules', 'runs'] as const;

export default function IotAutomationsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(AUTOMATION_TABS, 'rules');
  const [runsFilter, setRunsFilter] = useState<IotAutomation | null>(null);

  const showRuns = useMemo(() => (automation: IotAutomation) => {
    setRunsFilter(automation);
    setActiveTab('runs');
  }, [setActiveTab]);

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof AUTOMATION_TABS[number])}>
        <TabPane tab="联动规则" itemKey="rules">
          <AutomationRulesTab onShowRuns={showRuns} />
        </TabPane>
        <TabPane tab="执行记录" itemKey="runs">
          <AutomationRunsTab filterAutomation={runsFilter} onClearFilter={() => setRunsFilter(null)} />
        </TabPane>
      </Tabs>
    </div>
  );
}

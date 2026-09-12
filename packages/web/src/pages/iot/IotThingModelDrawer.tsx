import { useState } from 'react';
import { ArrayField, Banner, Button, Col, Form, Row, SideSheet, Spin, Tabs, TabPane, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Download, Plus, Upload } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { confirmAndDelete, listTableProps } from '@/components/list-page';
import {
  IOT_ACCESS_MODE_LABELS, IOT_ACCESS_MODE_OPTIONS, IOT_EVENT_LEVEL_LABELS, IOT_EVENT_LEVEL_OPTIONS,
  IOT_PROPERTY_TYPE_LABELS, IOT_PROPERTY_TYPE_OPTIONS,
} from '@zenith/shared/iot';
import type {
  CreateIotEventInput, CreateIotPropertyInput, CreateIotServiceInput, ImportIotTslInput,
  IotParamDef, IotProduct, IotProductEvent, IotProductProperty, IotProductService,
} from '@zenith/shared/iot';
import {
  useCreateIotEvent, useCreateIotProperty, useCreateIotService,
  useDeleteIotEvent, useDeleteIotProperty, useDeleteIotService, useImportIotTsl,
  useIotThingModel, useUpdateIotEvent, useUpdateIotProperty, useUpdateIotService,
} from '@/hooks/queries/iot-products';
import { IOT_EVENT_LEVEL_COLORS } from './iot-tag-colors';

/** 属性表单值：枚举取值以「每行 值=显示名」文本编辑，提交前由 beforeSave 解析；记录里的 null 归一为空串 */
interface PropertyFormValues extends Partial<Omit<CreateIotPropertyInput, 'enumOptions'>> {
  enumText?: string;
}

type ServiceFormValues = Partial<CreateIotServiceInput>;

type EventFormValues = Partial<CreateIotEventInput>;

/** 参数定义行：表单里未填的单位 / 量程归一为 null */
function normalizeParamDefs(params: IotParamDef[] | undefined): IotParamDef[] {
  return (params ?? []).map((p) => ({
    ...p,
    unit: p.unit || null,
    minValue: p.minValue ?? null,
    maxValue: p.maxValue ?? null,
  }));
}

/** enumOptions（{值: 显示名}）↔ 文本域「每行 值=显示名」互转 */
function enumOptionsToText(options: Record<string, string> | null | undefined): string {
  return Object.entries(options ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
}

function textToEnumOptions(text: string | undefined): Record<string, string> | null {
  const entries = (text ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=');
      return idx > 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const : null;
    })
    .filter((e): e is readonly [string, string] => e !== null && e[0] !== '' && e[1] !== '');
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/** 标识符列：code 样式 + 超宽省略出 tooltip（禁止换行撑高行） */
const identifierColumn: ColumnProps = {
  title: '标识符',
  dataIndex: 'identifier',
  width: 180,
  render: (v: string) => (
    <Typography.Text code ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v}</Typography.Text>
  ),
};

/** 服务/事件的参数列摘要 */
function renderParamsSummary(params: IotParamDef[]) {
  if (params.length === 0) return EMPTY_PLACEHOLDER;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {params.map((p) => (
        <Tag key={p.identifier} size="small" color="cyan">
          {p.identifier}: {IOT_PROPERTY_TYPE_LABELS[p.dataType]}{p.required ? ' *' : ''}
        </Tag>
      ))}
    </div>
  );
}

/** 服务/事件共用的参数定义编辑器（ArrayField 行编辑） */
function ParamsArrayField() {
  return (
    <Form.Slot label="参数定义">
      <ArrayParamRows />
    </Form.Slot>
  );
}

interface ArrayFieldRow {
  field: string;
  key: string;
  remove: () => void;
}

function ArrayParamRows() {
  return (
    <ArrayField field="params">
      {({ add, arrayFields }: { add: () => void; arrayFields: ArrayFieldRow[] }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {arrayFields.map(({ field, key, remove }) => (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Form.Input field={`${field}[identifier]`} noLabel placeholder="标识符" style={{ width: 120 }}
                rules={[{ required: true, message: '必填' }, { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '字母开头' }]} />
              <Form.Input field={`${field}[name]`} noLabel placeholder="名称" style={{ width: 100 }}
                rules={[{ required: true, message: '必填' }]} />
              <Form.Select field={`${field}[dataType]`} noLabel placeholder="类型" style={{ width: 90 }}
                optionList={IOT_PROPERTY_TYPE_OPTIONS} initValue="number" />
              <Form.Input field={`${field}[unit]`} noLabel placeholder="单位" style={{ width: 70 }} />
              <Form.InputNumber field={`${field}[minValue]`} noLabel placeholder="下限" style={{ width: 84 }} hideButtons />
              <Form.InputNumber field={`${field}[maxValue]`} noLabel placeholder="上限" style={{ width: 84 }} hideButtons />
              <Form.Switch field={`${field}[required]`} noLabel checkedText="必填" uncheckedText="选填" />
              <Button type="danger" theme="borderless" size="small" onClick={remove}>删除</Button>
            </div>
          ))}
          <div>
            <Button icon={<Plus size={14} />} theme="light" size="small" onClick={add}>添加参数</Button>
          </div>
        </div>
      )}
    </ArrayField>
  );
}

interface IotThingModelDrawerProps {
  product: IotProduct | null;
  onClose: () => void;
}

/** 物模型编辑器：属性 / 服务 / 事件三 Tab + TSL 导入导出 */
export default function IotThingModelDrawer({ product, onClose }: Readonly<IotThingModelDrawerProps>) {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('iot:product:update');
  const productId = product?.id ?? null;
  const modelQuery = useIotThingModel(productId);
  const model = modelQuery.data;

  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const importMutation = useImportIotTsl();

  // ─── 属性 ───────────────────────────────────────────────────────────────────
  const createPropertyMutation = useCreateIotProperty();
  const updatePropertyMutation = useUpdateIotProperty();
  const propertyModal = useEditModal<IotProductProperty, PropertyFormValues, Partial<CreateIotPropertyInput>>({
    entityName: '属性',
    save: {
      mutateAsync: ({ id, values }) => (id === undefined
        ? createPropertyMutation.mutateAsync({ params: { id: productId! }, body: values as CreateIotPropertyInput })
        : updatePropertyMutation.mutateAsync({ params: { id: productId!, propertyId: id }, body: values })),
      isPending: createPropertyMutation.isPending || updatePropertyMutation.isPending,
    },
    toValues: (r) => ({
      identifier: r.identifier,
      name: r.name,
      dataType: r.dataType,
      accessMode: r.accessMode,
      unit: r.unit ?? '',
      minValue: r.minValue,
      maxValue: r.maxValue,
      enumText: enumOptionsToText(r.enumOptions),
      featured: r.featured,
      anomalyEnabled: r.anomalyEnabled,
      sort: r.sort,
      description: r.description ?? '',
    }),
    defaults: { dataType: 'number', accessMode: 'r', featured: false, anomalyEnabled: false, sort: 0 },
    beforeSave: (values, ctx) => ({
      ...(ctx.isEdit ? {} : { identifier: values.identifier }),
      name: values.name,
      dataType: values.dataType,
      accessMode: values.accessMode,
      unit: values.unit || null,
      minValue: values.minValue ?? null,
      maxValue: values.maxValue ?? null,
      enumOptions: values.dataType === 'enum' ? textToEnumOptions(values.enumText) : null,
      featured: Boolean(values.featured),
      anomalyEnabled: values.dataType === 'number' ? Boolean(values.anomalyEnabled) : false,
      sort: values.sort ?? 0,
      description: values.description || null,
    }),
    labelWidth: 90,
  });
  const deletePropertyMutation = useDeleteIotProperty();

  // ─── 服务 ───────────────────────────────────────────────────────────────────
  const createServiceMutation = useCreateIotService();
  const updateServiceMutation = useUpdateIotService();
  const serviceModal = useEditModal<IotProductService, ServiceFormValues, Partial<CreateIotServiceInput>>({
    entityName: '服务',
    save: {
      mutateAsync: ({ id, values }) => (id === undefined
        ? createServiceMutation.mutateAsync({ params: { id: productId! }, body: values as CreateIotServiceInput })
        : updateServiceMutation.mutateAsync({ params: { id: productId!, serviceId: id }, body: values })),
      isPending: createServiceMutation.isPending || updateServiceMutation.isPending,
    },
    toValues: (r) => ({
      identifier: r.identifier,
      name: r.name,
      params: r.params,
      danger: r.danger,
      sort: r.sort,
      description: r.description ?? '',
    }),
    defaults: { params: [], danger: false, sort: 0 },
    beforeSave: (values, ctx) => ({
      ...(ctx.isEdit ? {} : { identifier: values.identifier }),
      name: values.name,
      params: normalizeParamDefs(values.params),
      danger: Boolean(values.danger),
      sort: values.sort ?? 0,
      description: values.description || null,
    }),
    labelWidth: 90,
  });
  const deleteServiceMutation = useDeleteIotService();

  // ─── 事件 ───────────────────────────────────────────────────────────────────
  const createEventMutation = useCreateIotEvent();
  const updateEventMutation = useUpdateIotEvent();
  const eventModal = useEditModal<IotProductEvent, EventFormValues, Partial<CreateIotEventInput>>({
    entityName: '事件',
    save: {
      mutateAsync: ({ id, values }) => (id === undefined
        ? createEventMutation.mutateAsync({ params: { id: productId! }, body: values as CreateIotEventInput })
        : updateEventMutation.mutateAsync({ params: { id: productId!, eventId: id }, body: values })),
      isPending: createEventMutation.isPending || updateEventMutation.isPending,
    },
    toValues: (r) => ({
      identifier: r.identifier,
      name: r.name,
      level: r.level,
      params: r.params,
      sort: r.sort,
      description: r.description ?? '',
    }),
    defaults: { level: 'info', params: [], sort: 0 },
    beforeSave: (values, ctx) => ({
      ...(ctx.isEdit ? {} : { identifier: values.identifier }),
      name: values.name,
      level: values.level,
      params: normalizeParamDefs(values.params),
      sort: values.sort ?? 0,
      description: values.description || null,
    }),
    labelWidth: 90,
  });
  const deleteEventMutation = useDeleteIotEvent();

  // ─── TSL 导入导出 ───────────────────────────────────────────────────────────
  function handleExport() {
    if (!model || !product) return;
    const tsl = {
      properties: model.properties.map(({ identifier, name, dataType, accessMode, unit, minValue, maxValue, enumOptions, featured, sort, description }) =>
        ({ identifier, name, dataType, accessMode, unit, minValue, maxValue, enumOptions, featured, sort, description })),
      services: model.services.map(({ identifier, name, params, danger, sort, description }) =>
        ({ identifier, name, params, danger, sort, description })),
      events: model.events.map(({ identifier, name, level, params, sort, description }) =>
        ({ identifier, name, level, params, sort, description })),
    };
    const blob = new Blob([JSON.stringify(tsl, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tsl-${product.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (!productId) return;
    let parsed: ImportIotTslInput;
    try {
      parsed = JSON.parse(importText) as ImportIotTslInput;
    } catch {
      Toast.error('不是合法的 JSON');
      return;
    }
    await importMutation.mutateAsync({ params: { id: productId }, body: parsed });
    Toast.success('物模型已导入');
    setImportVisible(false);
    setImportText('');
  }

  // ─── 列定义 ─────────────────────────────────────────────────────────────────
  const propertyColumns: ColumnProps<IotProductProperty>[] = [
    identifierColumn,
    { title: '名称', dataIndex: 'name', width: 110 },
    {
      title: '类型', dataIndex: 'dataType', width: 90,
      render: (v: IotProductProperty['dataType']) => <Tag size="small">{IOT_PROPERTY_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '读写', dataIndex: 'accessMode', width: 80,
      render: (v: IotProductProperty['accessMode']) => (
        <Tag size="small" color={v === 'rw' ? 'green' : 'grey'}>{IOT_ACCESS_MODE_LABELS[v]}</Tag>
      ),
    },
    { title: '单位', dataIndex: 'unit', width: 70, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    {
      title: '量程 / 枚举', width: 140,
      render: (_: unknown, r: IotProductProperty) => {
        if (r.dataType === 'enum') {
          const opts = Object.entries(r.enumOptions ?? {});
          return opts.length > 0 ? renderEllipsis(opts.map(([k, v]) => `${k}=${v}`).join('、')) : EMPTY_PLACEHOLDER;
        }
        if (r.minValue == null && r.maxValue == null) return EMPTY_PLACEHOLDER;
        return `${r.minValue ?? '-∞'} ~ ${r.maxValue ?? '+∞'}`;
      },
    },
    {
      title: '关键属性', dataIndex: 'featured', width: 90,
      render: (v: boolean) => v ? <Tag size="small" color="cyan">是</Tag> : EMPTY_PLACEHOLDER,
    },
    {
      title: '异常检测', dataIndex: 'anomalyEnabled', width: 90,
      render: (v: boolean) => v ? <Tag size="small" color="purple">开启</Tag> : EMPTY_PLACEHOLDER,
    },
    ...(canEdit ? [{
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: unknown, r: IotProductProperty) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme="borderless" size="small" onClick={() => propertyModal.openEdit(r)}>编辑</Button>
          <Button theme="borderless" size="small" type="danger" onClick={() => {
            confirmAndDelete({
              title: `确定要删除属性「${r.identifier}」吗？`,
              content: '历史遥测数据保留，图表与影子将不再声明该属性',
              run: () => deletePropertyMutation.mutateAsync({ params: { id: productId!, propertyId: r.id } }),
            });
          }}>删除</Button>
        </div>
      ),
    }] : []),
  ];

  const serviceColumns: ColumnProps<IotProductService>[] = [
    identifierColumn,
    { title: '名称', dataIndex: 'name', width: 110 },
    { title: '参数', render: (_: unknown, r: IotProductService) => renderParamsSummary(r.params) },
    {
      title: '高危', dataIndex: 'danger', width: 80,
      render: (v: boolean) => v ? <Tag size="small" color="red">高危</Tag> : EMPTY_PLACEHOLDER,
    },
    ...(canEdit ? [{
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: unknown, r: IotProductService) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme="borderless" size="small" onClick={() => serviceModal.openEdit(r)}>编辑</Button>
          <Button theme="borderless" size="small" type="danger" onClick={() => {
            confirmAndDelete({
              title: `确定要删除服务「${r.identifier}」吗？`,
              content: '删除后无法再向设备下发该服务',
              run: () => deleteServiceMutation.mutateAsync({ params: { id: productId!, serviceId: r.id } }),
            });
          }}>删除</Button>
        </div>
      ),
    }] : []),
  ];

  const eventColumns: ColumnProps<IotProductEvent>[] = [
    identifierColumn,
    { title: '名称', dataIndex: 'name', width: 110 },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: IotProductEvent['level']) => (
        <Tag size="small" color={IOT_EVENT_LEVEL_COLORS[v]}>{IOT_EVENT_LEVEL_LABELS[v]}</Tag>
      ),
    },
    { title: '参数', render: (_: unknown, r: IotProductEvent) => renderParamsSummary(r.params) },
    ...(canEdit ? [{
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: unknown, r: IotProductEvent) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme="borderless" size="small" onClick={() => eventModal.openEdit(r)}>编辑</Button>
          <Button theme="borderless" size="small" type="danger" onClick={() => {
            confirmAndDelete({
              title: `确定要删除事件「${r.identifier}」吗？`,
              content: '关联的事件告警规则将不再触发',
              run: () => deleteEventMutation.mutateAsync({ params: { id: productId!, eventId: r.id } }),
            });
          }}>删除</Button>
        </div>
      ),
    }] : []),
  ];

  const dataTypeFormKey = propertyModal.formKey;

  return (
    <SideSheet
      title={`物模型 · ${product?.name ?? ''}`}
      visible={product !== null}
      onCancel={onClose}
      width={1000}
      closeOnEsc
      bodyStyle={{ paddingBottom: 24 }}
    >
      <Banner
        type="info" closeIcon={null} style={{ marginBottom: 12 }}
        description="物模型是设备能力的唯一声明源：属性驱动遥测校验、影子与图表，服务驱动指令表单，事件驱动设备事件与告警。"
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 4 }}>
        <Button icon={<Download size={14} />} onClick={handleExport} disabled={!model}>导出 TSL</Button>
        {canEdit && (
          <Button icon={<Upload size={14} />} onClick={() => setImportVisible(true)}>导入 TSL</Button>
        )}
      </div>
      <Spin spinning={modelQuery.isPending}>
        <Tabs type="line" collapsible="auto">
          <TabPane tab={`属性（${model?.properties.length ?? 0}）`} itemKey="properties">
            {canEdit && (
              <div style={{ margin: '8px 0' }}>
                <Button icon={<Plus size={14} />} theme="light" onClick={propertyModal.openCreate}>新增属性</Button>
              </div>
            )}
            <ConfigurableTable
              columnSettingsKey="iot-thing-model-properties"
              columns={propertyColumns}
              {...listTableProps({ ...modelQuery, data: model?.properties ?? [] }, { empty: '尚未声明属性' })}
            />
          </TabPane>
          <TabPane tab={`服务（${model?.services.length ?? 0}）`} itemKey="services">
            {canEdit && (
              <div style={{ margin: '8px 0' }}>
                <Button icon={<Plus size={14} />} theme="light" onClick={serviceModal.openCreate}>新增服务</Button>
              </div>
            )}
            <ConfigurableTable
              columnSettingsKey="iot-thing-model-services"
              columns={serviceColumns}
              {...listTableProps({ ...modelQuery, data: model?.services ?? [] }, { empty: '尚未声明服务' })}
            />
          </TabPane>
          <TabPane tab={`事件（${model?.events.length ?? 0}）`} itemKey="events">
            {canEdit && (
              <div style={{ margin: '8px 0' }}>
                <Button icon={<Plus size={14} />} theme="light" onClick={eventModal.openCreate}>新增事件</Button>
              </div>
            )}
            <ConfigurableTable
              columnSettingsKey="iot-thing-model-events"
              columns={eventColumns}
              {...listTableProps({ ...modelQuery, data: model?.events ?? [] }, { empty: '尚未声明事件' })}
            />
          </TabPane>
        </Tabs>
      </Spin>

      {/* 属性编辑弹窗 */}
      <AppModal {...propertyModal.modalProps} width={800}>
        <Form key={dataTypeFormKey} {...propertyModal.formProps}>
          {({ formState }) => (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="identifier" label="标识符" placeholder="如 temperature"
                    disabled={propertyModal.isEdit}
                    extraText={propertyModal.isEdit ? '标识符一经声明不可变更' : '字母开头，仅字母/数字/下划线'}
                    rules={propertyModal.isEdit ? [] : [
                      { required: true, message: '标识符不能为空' },
                      { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '需以字母开头，仅支持字母、数字、下划线' },
                    ]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="name" label="名称" placeholder="如 温度"
                    rules={[{ required: true, message: '名称不能为空' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select field="dataType" label="数据类型" optionList={IOT_PROPERTY_TYPE_OPTIONS} style={{ width: '100%' }} />
                </Col>
                <Col span={12}>
                  <Form.RadioGroup field="accessMode" label="读写模式">
                    {IOT_ACCESS_MODE_OPTIONS.map((o) => (
                      <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
                    ))}
                  </Form.RadioGroup>
                </Col>
              </Row>
              {formState.values?.dataType === 'number' && (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.InputNumber field="minValue" label="量程下限" hideButtons style={{ width: '100%' }} />
                    </Col>
                    <Col span={12}>
                      <Form.InputNumber field="maxValue" label="量程上限" hideButtons style={{ width: '100%' }} />
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="unit" label="单位" placeholder="如 ℃" />
                    </Col>
                  </Row>
                </>
              )}
              {formState.values?.dataType === 'enum' && (
                <Form.TextArea field="enumText" label="枚举取值" rows={3}
                  placeholder={'每行一个：值=显示名\n如：\nopen=开启\nclosed=关闭'}
                  rules={[{ required: true, message: '枚举类型必须提供取值映射' }]} />
              )}
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Switch field="featured" label="关键属性" checkedText="是" uncheckedText="否"
                    extraText="设备列表快照列与遥测图表默认展示" />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
                </Col>
              </Row>
              {formState.values?.dataType === 'number' && (
                <Form.Switch field="anomalyEnabled" label="异常检测" checkedText="开" uncheckedText="关"
                  extraText="按近 7 天小时聚合基线做 3σ 偏离判定，异常记入设备事件流" />
              )}
              <Form.Input field="description" label="描述" placeholder="选填" />
            </>
          )}
        </Form>
      </AppModal>

      {/* 服务编辑弹窗 */}
      <AppModal {...serviceModal.modalProps} width={720}>
        <Form key={serviceModal.formKey} {...serviceModal.formProps}>
          <Form.Input field="identifier" label="标识符" placeholder="如 reboot"
            disabled={serviceModal.isEdit}
            extraText={serviceModal.isEdit ? '标识符一经声明不可变更' : '字母开头，仅字母/数字/下划线'}
            rules={serviceModal.isEdit ? [] : [
              { required: true, message: '标识符不能为空' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '需以字母开头，仅支持字母、数字、下划线' },
            ]} />
          <Form.Input field="name" label="名称" placeholder="如 重启设备"
            rules={[{ required: true, message: '名称不能为空' }]} />
          <ParamsArrayField />
          <Form.Switch field="danger" label="高危服务" checkedText="是" uncheckedText="否"
            extraText="下发前需要二次确认" />
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: 120 }} />
          <Form.Input field="description" label="描述" placeholder="选填" />
        </Form>
      </AppModal>

      {/* 事件编辑弹窗 */}
      <AppModal {...eventModal.modalProps} width={720}>
        <Form key={eventModal.formKey} {...eventModal.formProps}>
          <Form.Input field="identifier" label="标识符" placeholder="如 high_temperature"
            disabled={eventModal.isEdit}
            extraText={eventModal.isEdit ? '标识符一经声明不可变更' : '字母开头，仅字母/数字/下划线'}
            rules={eventModal.isEdit ? [] : [
              { required: true, message: '标识符不能为空' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '需以字母开头，仅支持字母、数字、下划线' },
            ]} />
          <Form.Input field="name" label="名称" placeholder="如 高温预警"
            rules={[{ required: true, message: '名称不能为空' }]} />
          <Form.Select field="level" label="级别" optionList={IOT_EVENT_LEVEL_OPTIONS} style={{ width: 200 }} />
          <ParamsArrayField />
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: 120 }} />
          <Form.Input field="description" label="描述" placeholder="选填" />
        </Form>
      </AppModal>

      {/* TSL 导入弹窗 */}
      <AppModal
        title="导入 TSL（全量替换）"
        visible={importVisible}
        onCancel={() => setImportVisible(false)}
        onOk={handleImport}
        okButtonProps={{ loading: importMutation.isPending }}
        width={640}
        closeOnEsc
      >
        <Banner type="warning" closeIcon={null} style={{ marginBottom: 12 }}
          description="导入将全量替换当前产品的属性、服务与事件定义，请先导出备份。" />
        <TextArea
          rows={12} placeholder='粘贴 TSL JSON：{"properties":[...],"services":[...],"events":[...]}'
          value={importText} onChange={setImportText}
        />
      </AppModal>
    </SideSheet>
  );
}

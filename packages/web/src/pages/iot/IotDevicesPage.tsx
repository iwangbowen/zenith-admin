import { useState, useMemo } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { Badge, Button, Col, Form, Row, SideSheet, Spin, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import ExportButton from '@/components/ExportButton';
import ImportButton from '@/components/ImportButton';
import AppModal from '@/components/AppModal';
import { EMPTY_PLACEHOLDER, copyableNoColumn, dateTimeColumn, renderEllipsis, enabledStatusColumn } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useDictItems } from '@/hooks/useDictItems';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { abortSubmit } from '@/lib/abort-submit';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import type { CreateIotDeviceGroupInput, CreateIotDeviceInput, IotDevice, IotDeviceGroup, IotMetricValue } from '@zenith/shared/iot';
import { IOT_NODE_TYPES, IOT_NODE_TYPE_OPTIONS } from '@zenith/shared/iot';
import { IotProductSelectField, useIotGroupOptions, useIotProductOptions } from './components/IotSelectors';
import { parseJsonObjectInput } from './iot-form-utils';
import {
  iotDeviceKeys, useDeleteIotDevices, useIotDeviceList, useSaveIotDevice,
  useSubmitIotBatchCommand, useSubmitIotBatchDesired,
} from '@/hooks/queries/iot-devices';
import { useAllIotGroups, useDeleteIotGroups, useSaveIotGroup } from '@/hooks/queries/iot-groups';
import IotDeviceDetailDrawer from './IotDeviceDetailDrawer';
import { compactParams } from '@/lib/query';

const { Text } = Typography;

interface SearchParams {
  keyword: string;
  status?: string;
  productId?: number;
  groupId?: number;
  nodeType?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, productId: undefined, groupId: undefined, nodeType: undefined };

/** 设备表单值：记录里的 null 在表单中归一为空串 / 未填，提交前由 beforeSave 还原 */
type IotDeviceFormValues = Partial<CreateIotDeviceInput>;

type IotDeviceGroupFormValues = Partial<CreateIotDeviceGroupInput>;

function renderMetricValue(v: number | string | boolean): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

export default function IotDevicesPage() {
  const { hasPermission } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const [detailDevice, setDetailDevice] = useState<IotDevice | null>(null);
  const { selectedRowKeys, setSelectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const [groupsVisible, setGroupsVisible] = useState(false);
  const [batchKind, setBatchKind] = useState<'command' | 'desired' | null>(null);

  const { options: productOptions } = useIotProductOptions();
  const { options: groupOptions } = useIotGroupOptions();
  // 分组管理弹窗内的表格：与 useIotGroupOptions 同 key，仅为拿到 refetch / isFetching 接刷新按钮
  const groupsQuery = useAllIotGroups();
  // 网关设备清单（子设备表单「所属网关」选项）
  const gatewaysQuery = useIotDeviceList({ page: 1, pageSize: 100, nodeType: 'gateway' });
  const gatewayOptions = (gatewaysQuery.data?.list ?? []).map((d) => ({ value: d.id, label: `${d.name}（${d.sn}）` }));

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: iotDeviceKeys.lists });

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    productId: submittedParams.productId,
    groupId: submittedParams.groupId,
    nodeType: enumValueOf(IOT_NODE_TYPES, submittedParams.nodeType),
  }), [submittedParams]);
  const listQuery = useIotDeviceList({
    page,
    pageSize,
    ...filterQuery,
  });

  const modal = useEditModal<IotDevice, IotDeviceFormValues, Partial<CreateIotDeviceInput>>({
    entityName: '设备',
    save: useSaveIotDevice(),
    toValues: (r) => ({
      productId: r.productId,
      name: r.name,
      nodeType: r.nodeType,
      gatewayId: r.gatewayId,
      latitude: r.latitude,
      longitude: r.longitude,
      address: r.address ?? '',
      firmwareVersion: r.firmwareVersion ?? '',
      status: r.status,
      groupIds: r.groupIds,
      remark: r.remark ?? '',
    }),
    defaults: { status: 'enabled', nodeType: 'direct', groupIds: [] },
    beforeSave: (values, { isEdit }) => ({
      productId: values.productId,
      name: values.name,
      // SN 仅创建时可指定，编辑不可变更
      ...(isEdit ? {} : { sn: values.sn?.trim() || undefined }),
      nodeType: values.nodeType,
      gatewayId: values.nodeType === 'sub' ? (values.gatewayId ?? null) : null,
      latitude: values.latitude ?? null,
      longitude: values.longitude ?? null,
      address: values.address || null,
      firmwareVersion: values.firmwareVersion || null,
      status: values.status,
      groupIds: values.groupIds ?? [],
      remark: values.remark || null,
    }),
    labelWidth: 100,
  });

  const deleteMutation = useDeleteIotDevices();

  // ─── 分组管理 ────────────────────────────────────────────────────────────────
  const groupModal = useEditModal<IotDeviceGroup, IotDeviceGroupFormValues, Partial<CreateIotDeviceGroupInput>>({
    entityName: '分组',
    save: useSaveIotGroup(),
    toValues: (r) => ({ name: r.name, description: r.description ?? '' }),
    beforeSave: (values) => ({
      name: values.name,
      description: values.description || null,
    }),
    labelWidth: 90,
  });
  const deleteGroupMutation = useDeleteIotGroups();

  // ─── 批量操作 ────────────────────────────────────────────────────────────────
  const batchCommandMutation = useSubmitIotBatchCommand();
  const batchDesiredMutation = useSubmitIotBatchDesired();
  const [batchFormApi, setBatchFormApi] = useState<FormApi | null>(null);

  async function handleBatchSubmit() {
    if (!batchFormApi) abortSubmit();
    let values: Record<string, unknown>;
    try {
      values = await batchFormApi.validate() as Record<string, unknown>;
    } catch {
      abortSubmit();
    }
    if (batchKind === 'command') {
      await batchCommandMutation.mutateAsync({
        body: {
          deviceIds: selectedRowKeys,
          service: values.service as string,
          params: parseJsonObjectInput({ text: (values.paramsText as string) ?? '', label: '参数', empty: 'null', toast: 'error', abort: true }),
          ttlSeconds: (values.ttlSeconds as number) || undefined,
        },
      });
    } else {
      const desired = parseJsonObjectInput({ text: (values.desiredText as string) ?? '', label: '期望属性', empty: 'null', toast: 'error', abort: true });
      if (!desired || Object.keys(desired).length === 0) {
        Toast.error('期望属性不能为空');
        abortSubmit();
      }
      await batchDesiredMutation.mutateAsync({
        body: {
          deviceIds: selectedRowKeys,
          desired: desired as Record<string, IotMetricValue>,
        },
      });
    }
    Toast.success('批量任务已提交，可在顶栏任务托盘查看进度');
    setBatchKind(null);
    clearSelection();
  }

  const columns: ColumnProps<IotDevice>[] = [
    copyableNoColumn('SN', 'sn', { width: 190 }),
    {
      title: '设备名称', dataIndex: 'name', minWidth: 150,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '所属产品', dataIndex: 'productName', width: 170,
      render: (v: string | null) => renderEllipsis(v),
    },
    {
      title: '形态', dataIndex: 'nodeType', width: 100,
      render: (v: IotDevice['nodeType'], r: IotDevice) => {
        if (v === 'gateway') {
          return <Tag size="small" color="indigo">网关{(r.subDeviceCount ?? 0) > 0 ? ` · ${r.subDeviceCount}` : ''}</Tag>;
        }
        if (v === 'sub') {
          return (
            <Tooltip content={r.gatewayName ? `所属网关：${r.gatewayName}` : undefined}>
              <Tag size="small" color="light-blue">子设备</Tag>
            </Tooltip>
          );
        }
        return <Text size="small" type="tertiary">直连</Text>;
      },
    },
    {
      title: '分组', width: 130,
      render: (_: unknown, r: IotDevice) => {
        const names = r.groupNames ?? [];
        if (names.length === 0) return EMPTY_PLACEHOLDER;
        return (
          <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
            <Tag size="small" style={{ maxWidth: 88 }}>{names[0]}</Tag>
            {names.length > 1 && <Tag size="small">+{names.length - 1}</Tag>}
          </div>
        );
      },
    },
    {
      title: '在线', dataIndex: 'online', width: 80, align: 'center',
      render: (v: boolean) => (
        <Badge dot type={v ? 'success' : 'tertiary'}>
          <Text size="small" type={v ? 'success' : 'tertiary'}>{v ? '在线' : '离线'}</Text>
        </Badge>
      ),
    },
    {
      title: '属性快照', width: 300,
      render: (_: unknown, r: IotDevice) => {
        const entries = Object.entries(r.reported ?? {});
        const pendingDesired = Object.keys(r.desired ?? {}).length;
        if (entries.length === 0 && pendingDesired === 0) return EMPTY_PLACEHOLDER;
        const shown = entries.slice(0, 2);
        return (
          <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {shown.map(([k, v]) => (
              <Tag key={k} size="small" color="cyan">{k}: {renderMetricValue(v)}</Tag>
            ))}
            {entries.length > 2 && <Tag size="small">+{entries.length - 2}</Tag>}
            {pendingDesired > 0 && <Tag size="small" color="orange">待确认 {pendingDesired}</Tag>}
          </div>
        );
      },
    },
    {
      title: '固件', dataIndex: 'firmwareVersion', width: 90,
      render: (v: string | null) => v ?? EMPTY_PLACEHOLDER,
    },
    dateTimeColumn<IotDevice>('最后在线', 'lastSeenAt'),
    enabledStatusColumn(),
    createOperationColumn<IotDevice>({
      width: 120,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        {
          key: 'detail', label: '详情', onClick: () => setDetailDevice(record),
        },
        ...(hasPermission('iot:device:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('iot:device:delete'),
          title: `确定要删除设备「${record.name}」吗？`,
          content: '遥测数据、事件与指令记录将一并清除，不可恢复',
          run: () => deleteMutation.mutateAsync([record.id]),
          onDeleted: () => setSelectedRowKeys((keys) => keys.filter((k) => k !== record.id)),
        }),
      ],
    }),
  ];

  const groupColumns: ColumnProps<IotDeviceGroup>[] = [
    { title: '分组名称', dataIndex: 'name', width: 160 },
    {
      title: '描述', dataIndex: 'description',
      render: (v: string | null) => v ?? EMPTY_PLACEHOLDER,
    },
    { title: '设备数', dataIndex: 'deviceCount', width: 80, align: 'right' },
    {
      title: '操作', width: 130,
      render: (_: unknown, r: IotDeviceGroup) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button theme="borderless" size="small" onClick={() => groupModal.openEdit(r)}>编辑</Button>
          <Button theme="borderless" size="small" type="danger" onClick={() => {
            confirmAndDelete({
              title: `确定要删除分组「${r.name}」吗？`,
              content: '组内设备本身不受影响',
              run: () => deleteGroupMutation.mutateAsync([r.id]),
            });
          }}>删除</Button>
        </div>
      ),
    },
  ];

  const canBatch = hasPermission('iot:device:batch');

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索 SN / 设备名..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={<>
          <FilterSelect<number>
            placeholder="全部产品"
            items={productOptions}
            {...bind('productId')}
          />
          <FilterSelect<number>
            placeholder="全部分组"
            items={groupOptions}
            {...bind('groupId')}
          />
          <FilterSelect
            placeholder="全部形态"
            items={IOT_NODE_TYPE_OPTIONS}
            {...bind('nodeType')}
          />
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
        </>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('iot:device:create')
            ? <CreateButton onClick={modal.openCreate}>注册设备</CreateButton> : null
        )}
        actions={<>
          {canBatch && selectedRowKeys.length > 0 && (
            <>
              <Button theme="light" onClick={() => setBatchKind('command')}>批量指令（{selectedRowKeys.length}）</Button>
              <Button theme="light" onClick={() => setBatchKind('desired')}>批量期望值（{selectedRowKeys.length}）</Button>
            </>
          )}
          {hasPermission('iot:device:import') && (
            <ImportButton entity="iot.devices" title="IoT 设备" onFinished={() => void listQuery.refetch()} />
          )}
          <ExportButton entity="iot.devices" query={filterQuery} />
          {hasPermission('iot:group:manage') && (
            <Button theme="light" onClick={() => setGroupsVisible(true)}>分组管理</Button>
          )}
        </>}
        mobileActions={<>
          {canBatch && selectedRowKeys.length > 0 && (
            <>
              <Button theme="borderless" onClick={() => setBatchKind('command')}>批量指令（{selectedRowKeys.length}）</Button>
              <Button theme="borderless" onClick={() => setBatchKind('desired')}>批量期望值（{selectedRowKeys.length}）</Button>
            </>
          )}
          {hasPermission('iot:device:import') && (
            <ImportButton entity="iot.devices" title="IoT 设备" label="导入设备" onFinished={() => void listQuery.refetch()} />
          )}
          <ExportButton entity="iot.devices" query={filterQuery} variant="flat" />
          {hasPermission('iot:group:manage') && (
            <Button theme="borderless" onClick={() => setGroupsVisible(true)}>分组管理</Button>
          )}
        </>}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<IotDevice>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无设备，点击「注册设备」接入第一台设备',
          rowSelection: canBatch ? rowSelection : undefined,
        })}
      />

      {/* 注册 / 编辑设备 */}
      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={660}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            {({ formState }) => {
              const nodeType = (formState.values as Record<string, unknown>).nodeType as string | undefined;
              return (
                <>
                  <IotProductSelectField />
                  <Form.Input field="name" label="设备名称" placeholder="如：机房 A-01 温湿度"
                    rules={[{ required: true, message: '设备名称不能为空' }]} />
                  {!modal.editing && (
                    <Form.Input
                      field="sn" label="设备 SN" placeholder="留空自动生成"
                      extraText="仅字母、数字、连字符；一经接入不可变更"
                      rules={[{ validator: (_r, v: string) => !v || /^[0-9A-Za-z-]{4,64}$/.test(v), message: 'SN 为 4-64 位字母、数字或连字符' }]}
                    />
                  )}
                  <Form.RadioGroup field="nodeType" label="设备形态"
                    extraText={nodeType === 'gateway' ? '网关可代理子设备接入（gateway:batch 帧）' : nodeType === 'sub' ? '子设备经网关代理接入，无需自己的连接与密钥' : undefined}>
                    {IOT_NODE_TYPE_OPTIONS.map((o) => (
                      <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>
                    ))}
                  </Form.RadioGroup>
                  {nodeType === 'sub' && (
                    <Form.Select
                      field="gatewayId" label="所属网关" placeholder="选择网关设备" style={{ width: '100%' }}
                      optionList={gatewayOptions}
                      rules={[{ required: true, message: '子设备必须指定所属网关' }]}
                      emptyContent="暂无网关设备（先注册形态为「网关」的设备）"
                    />
                  )}
                  <Form.Select
                    field="groupIds" label="所属分组" placeholder="选择分组（可多选）" multiple showClear style={{ width: '100%' }}
                    optionList={groupOptions}
                  />
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.InputNumber field="latitude" label="纬度" hideButtons style={{ width: '100%' }}
                        min={-90} max={90} placeholder="如 39.9087（选填）" />
                    </Col>
                    <Col span={12}>
                      <Form.InputNumber field="longitude" label="经度" hideButtons style={{ width: '100%' }}
                        min={-180} max={180} placeholder="如 116.3975（选填）" />
                    </Col>
                  </Row>
                  <Form.Input field="address" label="安装地址" placeholder="如：北京市东城区 A 栋机房（选填）"
                    extraText="填写经纬度后设备将出现在「设备地图」中" />
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="firmwareVersion" label="固件版本" placeholder="如 1.0.0（选填）" />
                    </Col>
                    <Col span={12}>
                      <FormStatusRadioGroup />
                    </Col>
                  </Row>
                  <Form.TextArea field="remark" label="备注" rows={2} placeholder="安装位置等说明（选填）" maxCount={256} />
                </>
              );
            }}
          </Form>
        </Spin>
      </SideSheet>

      {/* 分组管理 */}
      <AppModal
        title="设备分组管理"
        visible={groupsVisible}
        onCancel={() => setGroupsVisible(false)}
        footer={null}
        width={640}
        closeOnEsc
      >
        <div style={{ marginBottom: 8 }}>
          <CreateButton onClick={groupModal.openCreate}>新增分组</CreateButton>
        </div>
        <ConfigurableTable
          columnSettingsKey="iot-device-groups"
          columns={groupColumns}
          {...listTableProps(groupsQuery, { empty: '暂无分组' })}
        />
        <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
          设备加入分组：在设备「编辑」表单中选择所属分组；批量操作可按分组圈选目标。
        </Text>
      </AppModal>

      <AppModal {...groupModal.modalProps} width={480}>
        <Form key={groupModal.formKey} {...groupModal.formProps}>
          <Form.Input field="name" label="分组名称" placeholder="如：机房 A 区"
            rules={[{ required: true, message: '分组名称不能为空' }]} />
          <Form.TextArea field="description" label="描述" rows={2} placeholder="选填" maxCount={256} />
        </Form>
      </AppModal>

      {/* 批量操作 */}
      <AppModal
        title={batchKind === 'command' ? `批量下发指令（${selectedRowKeys.length} 台）` : `批量设置期望属性（${selectedRowKeys.length} 台）`}
        visible={batchKind !== null}
        onCancel={() => setBatchKind(null)}
        onOk={handleBatchSubmit}
        okButtonProps={{ loading: batchCommandMutation.isPending || batchDesiredMutation.isPending }}
        width={560}
        closeOnEsc
      >
        <Form
          key={batchKind ?? 'none'}
          labelPosition="left"
          labelWidth={100}
          getFormApi={(api) => setBatchFormApi(api)}
        >
          {batchKind === 'command' ? (
            <>
              <Form.Input field="service" label="服务标识符" placeholder="如 reboot"
                extraText="按各设备产品的物模型校验；未声明该服务的设备将失败并计入行级明细"
                rules={[
                  { required: true, message: '服务标识符不能为空' },
                  { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '需以字母开头' },
                ]} />
              <Form.TextArea field="paramsText" label="参数 JSON" rows={3} placeholder='如 {"offset": 1.5}（无参留空）' />
              <Form.InputNumber field="ttlSeconds" label="超时秒数" min={10} max={86400} placeholder="默认 300" style={{ width: 160 }} />
            </>
          ) : (
            <Form.TextArea field="desiredText" label="期望属性 JSON" rows={4}
              placeholder='如 {"report_interval": 60, "led_enabled": false}'
              extraText="仅物模型中声明为「读写」的属性可下发，按各设备产品校验"
              rules={[{ required: true, message: '期望属性不能为空' }]} />
          )}
        </Form>
      </AppModal>

      {/* 导入设备走通用 ImportButton（导入中心 definition iot.devices） */}

      <IotDeviceDetailDrawer device={detailDevice} onClose={() => setDetailDevice(null)} />
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Banner, Button, Descriptions, Form, Popconfirm, Radio, RadioGroup, Select,
  SideSheet, Spin, Table, TabPane, Tabs, Tag, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { AreaChart, EmptyChart, LineChart, chartOptions, makeAreaSpec, makeLineSpec, useChartPalette } from '@/components/charts';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { EMPTY_PLACEHOLDER, dateTimeColumn } from '@/utils/table-columns';
import { confirmDanger } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';
import { enumValueOf } from '@zenith/shared/core';
import {
  IOT_ACCESS_MODE_LABELS, IOT_COMMAND_STATUS_LABELS, IOT_DEVICE_EVENT_KINDS, IOT_DEVICE_EVENT_KIND_LABELS,
  IOT_DEVICE_EVENT_KIND_OPTIONS, IOT_EVENT_LEVELS, IOT_EVENT_LEVEL_LABELS, IOT_EVENT_LEVEL_OPTIONS,
  IOT_LOG_LEVELS, IOT_LOG_LEVEL_LABELS, IOT_LOG_LEVEL_OPTIONS, IOT_PROPERTY_TYPE_LABELS, iotIngestContract,
} from '@zenith/shared/iot';
import type {
  IotCommand, IotDevice, IotDeviceEvent, IotDeviceLog, IotDeviceShadow, IotMetricValue, IotParamDef,
  IotProductProperty, IotProductService,
} from '@zenith/shared/iot';
import {
  iotDeviceEventKeys, iotShadowKeys, iotTelemetryKeys,
  useClearIotDesired, useIotCommands, useIotDeviceEvents, useIotDeviceLogs, useIotDeviceShadow,
  useIotTelemetry, useIotTelemetryAgg, useResetIotDeviceSecret, useSendIotCommand, useSetIotDesired,
} from '@/hooks/queries/iot-devices';
import { useIotThingModel } from '@/hooks/queries/iot-products';
import { useWebSocket, useWsConnected } from '@/hooks/useWebSocket';
import IotTopologyView from './IotTopologyView';
import { FilterSelect } from '@/components/search-filters';

const { Text } = Typography;

const COMMAND_STATUS_COLORS = {
  pending: 'grey',
  delivered: 'blue',
  acked: 'green',
  failed: 'red',
  expired: 'orange',
} as const satisfies Record<IotCommand['status'], string>;

const EVENT_LEVEL_COLORS = { info: 'blue', warn: 'orange', fault: 'red' } as const;

const EVENT_KIND_COLORS = { lifecycle: 'grey', model: 'cyan', anomaly: 'purple' } as const;

const LOG_LEVEL_COLORS = { debug: 'grey', info: 'blue', warn: 'orange', error: 'red' } as const;

function formatValue(v: IotMetricValue | undefined, unit?: string | null): string {
  if (v === undefined) return EMPTY_PLACEHOLDER;
  const text = typeof v === 'boolean' ? (v ? '开' : '关') : String(v);
  return unit ? `${text} ${unit}` : text;
}

/** 按参数/属性定义渲染表单字段（number/boolean/enum/string） */
function DefField({ def }: Readonly<{ def: IotParamDef }>) {
  const rules = def.required ? [{ required: true, message: `${def.name}不能为空` }] : [];
  const label = def.unit ? `${def.name}（${def.unit}）` : def.name;
  switch (def.dataType) {
    case 'number':
      return (
        <Form.InputNumber
          field={def.identifier} label={label} hideButtons style={{ width: 200 }}
          min={def.minValue ?? undefined} max={def.maxValue ?? undefined} rules={rules}
          extraText={def.minValue != null || def.maxValue != null ? `量程 ${def.minValue ?? '-∞'} ~ ${def.maxValue ?? '+∞'}` : undefined}
        />
      );
    case 'boolean':
      return <Form.Switch field={def.identifier} label={label} checkedText="开" uncheckedText="关" />;
    case 'enum':
      return (
        <Form.Select
          field={def.identifier} label={label} style={{ width: 200 }} rules={rules}
          optionList={Object.entries(def.enumOptions ?? {}).map(([value, text]) => ({ value, label: `${text}（${value}）` }))}
        />
      );
    default:
      return <Form.Input field={def.identifier} label={label} rules={rules} />;
  }
}

interface IotDeviceDetailDrawerProps {
  device: IotDevice | null;
  onClose: () => void;
}

/** 设备详情抽屉：接入凭证 / 属性影子 / 遥测曲线 / 指令 / 事件时间线 */
export default function IotDeviceDetailDrawer({ device, onClose }: Readonly<IotDeviceDetailDrawerProps>) {
  const { hasPermission } = usePermission();
  const palette = useChartPalette();
  const canCommand = hasPermission('iot:command:send');

  const deviceId = device?.id ?? null;
  const modelQuery = useIotThingModel(device?.productId ?? null);
  const model = modelQuery.data;
  const shadowQuery = useIotDeviceShadow(deviceId);
  const shadow = shadowQuery.data;
  const qc = useQueryClient();
  const wsConnected = useWsConnected();

  // 实时通道：遥测/影子帧直接合并进缓存（免轮询），事件帧精确失效事件列表
  useWebSocket((msg) => {
    if (!deviceId) return;
    if (msg.type === 'iot:shadow' && msg.payload.deviceId === deviceId) {
      const { reported, desired, desiredVersion } = msg.payload;
      qc.setQueryData<IotDeviceShadow>(iotShadowKeys.of(deviceId), (prev) =>
        prev ? { ...prev, reported, desired, desiredVersion } : prev);
    } else if (msg.type === 'iot:telemetry' && msg.payload.deviceId === deviceId) {
      const { metrics, reportedAt } = msg.payload;
      qc.setQueryData<IotDeviceShadow>(iotShadowKeys.of(deviceId), (prev) =>
        prev ? { ...prev, reported: { ...prev.reported, ...metrics }, reportedAt, online: true } : prev);
      void qc.invalidateQueries({ queryKey: iotTelemetryKeys.all });
    } else if (msg.type === 'iot:device-event' && msg.payload.deviceId === deviceId) {
      void qc.invalidateQueries({ queryKey: iotDeviceEventKeys.all });
    }
  });

  // ─── 属性影子 ────────────────────────────────────────────────────────────────
  const [desiredTarget, setDesiredTarget] = useState<IotProductProperty | null>(null);
  const [desiredFormApi, setDesiredFormApi] = useState<FormApi | null>(null);
  const setDesiredMutation = useSetIotDesired();
  const clearDesiredMutation = useClearIotDesired();

  async function handleSetDesired() {
    if (!deviceId || !desiredTarget || !desiredFormApi) abortSubmit();
    let values: Record<string, unknown>;
    try {
      values = await desiredFormApi.validate() as Record<string, unknown>;
    } catch {
      abortSubmit();
    }
    const value = values[desiredTarget.identifier];
    if (value === undefined || value === null || value === '') {
      Toast.error('请填写期望值');
      abortSubmit();
    }
    await setDesiredMutation.mutateAsync({
      params: { id: deviceId },
      body: { desired: { [desiredTarget.identifier]: value as IotMetricValue } },
    });
    Toast.success('期望值已下发，设备确认后自动收敛');
    setDesiredTarget(null);
  }

  interface PropertyRow {
    key: string;
    prop: IotProductProperty | null;
    identifier: string;
    reported: IotMetricValue | undefined;
    desired: IotMetricValue | undefined;
  }

  const propertyRows: PropertyRow[] = useMemo(() => {
    const reported = shadow?.reported ?? {};
    const desired = shadow?.desired ?? {};
    const rows: PropertyRow[] = (model?.properties ?? []).map((p) => ({
      key: p.identifier,
      prop: p,
      identifier: p.identifier,
      reported: reported[p.identifier],
      desired: desired[p.identifier],
    }));
    const declared = new Set(rows.map((r) => r.identifier));
    for (const [k, v] of Object.entries(reported)) {
      if (!declared.has(k)) rows.push({ key: k, prop: null, identifier: k, reported: v, desired: desired[k] });
    }
    return rows;
  }, [model?.properties, shadow?.reported, shadow?.desired]);

  const propertyColumns: ColumnProps<PropertyRow>[] = [
    {
      title: '属性', width: 180,
      render: (_: unknown, r: PropertyRow) => (
        <div>
          <div>{r.prop?.name ?? <Text type="tertiary">未声明</Text>}</div>
          <Text type="tertiary" size="small" code>{r.identifier}</Text>
        </div>
      ),
    },
    {
      title: '类型', width: 130,
      render: (_: unknown, r: PropertyRow) => r.prop
        ? (
            <span>
              <Tag size="small">{IOT_PROPERTY_TYPE_LABELS[r.prop.dataType]}</Tag>{' '}
              <Tag size="small" color={r.prop.accessMode === 'rw' ? 'green' : 'grey'}>{IOT_ACCESS_MODE_LABELS[r.prop.accessMode]}</Tag>
            </span>
          )
        : EMPTY_PLACEHOLDER,
    },
    {
      title: '当前值', width: 140,
      render: (_: unknown, r: PropertyRow) => {
        if (r.prop?.dataType === 'enum' && typeof r.reported === 'string') {
          return <Text strong>{r.prop.enumOptions?.[r.reported] ?? r.reported}</Text>;
        }
        return <Text strong>{formatValue(r.reported, r.prop?.unit)}</Text>;
      },
    },
    {
      title: '期望值（待确认）', width: 140,
      render: (_: unknown, r: PropertyRow) => r.desired !== undefined
        ? <Tag size="small" color="orange">{formatValue(r.desired, r.prop?.unit)}</Tag>
        : EMPTY_PLACEHOLDER,
    },
    ...(canCommand ? [{
      title: '操作', width: 90,
      render: (_: unknown, r: PropertyRow) => r.prop?.accessMode === 'rw'
        ? <Button theme="borderless" size="small" onClick={() => setDesiredTarget(r.prop)}>下发</Button>
        : null,
    }] : []),
  ];

  // ─── 遥测曲线 ────────────────────────────────────────────────────────────────
  const [days, setDays] = useState(1);
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const canViewTelemetry = hasPermission('iot:telemetry:view');
  // 近 24h 查明细；长窗口切小时聚合（min/avg/max），明细保留期与图表性能解耦
  const useAgg = days > 1;
  const telemetryQuery = useIotTelemetry(canViewTelemetry && !useAgg ? deviceId : null, days);
  const points = useMemo(() => telemetryQuery.data ?? [], [telemetryQuery.data]);

  // 可绘制指标 = 物模型数值属性 ∪ 数据中出现过的数值键
  const metricKeys = useMemo(() => {
    const keys = new Set<string>((model?.properties ?? []).filter((p) => p.dataType === 'number').map((p) => p.identifier));
    for (const p of points) {
      for (const [k, v] of Object.entries(p.metrics)) {
        if (typeof v === 'number') keys.add(k);
      }
    }
    return [...keys];
  }, [model?.properties, points]);

  const activeMetric = metricKey && metricKeys.includes(metricKey) ? metricKey : (metricKeys[0] ?? null);
  const activeProp = model?.properties.find((p) => p.identifier === activeMetric);
  const aggQuery = useIotTelemetryAgg(canViewTelemetry && useAgg ? deviceId : null, activeMetric, days);

  const chartData = useMemo(() => {
    if (!activeMetric) return [];
    return points
      .filter((p) => typeof p.metrics[activeMetric] === 'number')
      .map((p) => ({ time: p.reportedAt, value: p.metrics[activeMetric] as number }));
  }, [points, activeMetric]);

  const metricLabel = activeProp
    ? `${activeProp.name}${activeProp.unit ? `（${activeProp.unit}）` : ''}`
    : (activeMetric ?? '指标');

  const chartSpec = useMemo(() => makeAreaSpec({
    data: chartData,
    xField: 'time',
    series: [{ field: 'value', name: metricLabel, color: palette.primary }],
    palette,
    fillOpacity: 0.16,
    axis: { xLabel: (value) => String(value).slice(5, 16) },
    tooltip: { title: (value) => `时间：${value}` },
  }), [chartData, metricLabel, palette]);

  const aggData = useMemo(() => (aggQuery.data ?? []).map((r) => ({
    time: r.bucket,
    min: r.minValue,
    avg: r.avgValue,
    max: r.maxValue,
  })), [aggQuery.data]);

  const aggSpec = useMemo(() => makeLineSpec({
    data: aggData,
    xField: 'time',
    series: [
      { field: 'max', name: '小时最高', color: '#fa8c16' },
      { field: 'avg', name: `${metricLabel} · 小时均值`, color: palette.primary },
      { field: 'min', name: '小时最低', color: '#13c2c2' },
    ],
    palette,
    axis: { xLabel: (value) => String(value).slice(5, 13) },
    tooltip: { title: (value) => `小时桶：${value}` },
  }), [aggData, metricLabel, palette]);

  const chartLoading = useAgg ? aggQuery.isFetching : telemetryQuery.isFetching;
  const chartEmpty = useAgg ? aggData.length === 0 : chartData.length === 0;

  // ─── 指令 ────────────────────────────────────────────────────────────────────
  const {
    page: commandPage,
    pageSize: commandPageSize,
    setPage: setCommandPage,
    buildPagination: buildCommandPagination,
  } = usePagination(5);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [commandFormApi, setCommandFormApi] = useState<FormApi | null>(null);
  const commandsQuery = useIotCommands(canCommand ? deviceId : null, { page: commandPage, pageSize: commandPageSize });
  const sendCommandMutation = useSendIotCommand();

  const services = model?.services ?? [];
  const activeService: IotProductService | undefined = services.find((s) => s.identifier === serviceId) ?? services[0];

  async function doSendCommand(service: IotProductService, params: Record<string, unknown> | null) {
    if (!deviceId) return;
    const row = await sendCommandMutation.mutateAsync({
      params: { id: deviceId },
      body: { service: service.identifier, params },
    });
    Toast.success(row.status === 'delivered' ? '指令已实时送达设备' : '设备离线，指令将在上线后送达');
    setCommandPage(1);
  }

  async function handleSendCommand() {
    if (!activeService) {
      Toast.error('请选择服务');
      return;
    }
    let params: Record<string, unknown> | null = null;
    if ((activeService.params ?? []).length > 0) {
      if (!commandFormApi) return;
      let values: Record<string, unknown>;
      try {
        values = await commandFormApi.validate() as Record<string, unknown>;
      } catch {
        return;
      }
      params = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    }
    if (activeService.danger) {
      confirmDanger({
        title: `确定要下发高危服务「${activeService.name}」吗？`,
        content: '该服务被标记为高危操作，请确认影响面',
        onOk: () => doSendCommand(activeService, params),
      });
      return;
    }
    await doSendCommand(activeService, params);
  }

  const commandColumns: ColumnProps<IotCommand>[] = [
    { title: '指令', dataIndex: 'service', width: 130, render: (v: string) => <Text code>{v}</Text> },
    {
      title: '参数', dataIndex: 'params', width: 150,
      render: (v: Record<string, unknown> | null) => v && Object.keys(v).length > 0
        ? <Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 140 }}>{JSON.stringify(v)}</Text>
        : EMPTY_PLACEHOLDER,
    },
    {
      // 失败原因不塞进 Tag（长度不可控），悬浮查看
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: IotCommand['status'], r: IotCommand) => {
        const tag = <Tag size="small" color={COMMAND_STATUS_COLORS[v]}>{IOT_COMMAND_STATUS_LABELS[v]}</Tag>;
        return v === 'failed' && r.errorMsg ? <Tooltip content={r.errorMsg}>{tag}</Tooltip> : tag;
      },
    },
    dateTimeColumn<IotCommand>('下发时间', 'createdAt'),
    dateTimeColumn<IotCommand>('回执时间', 'ackedAt'),
  ];

  // ─── 事件 ────────────────────────────────────────────────────────────────────
  const {
    page: eventPage,
    pageSize: eventPageSize,
    setPage: setEventPage,
    buildPagination: buildEventPagination,
  } = usePagination(10);
  const [eventKind, setEventKind] = useState<string | undefined>();
  const [eventLevel, setEventLevel] = useState<string | undefined>();
  const eventsQuery = useIotDeviceEvents(deviceId, {
    page: eventPage,
    pageSize: eventPageSize,
    kind: enumValueOf(IOT_DEVICE_EVENT_KINDS, eventKind),
    level: enumValueOf(IOT_EVENT_LEVELS, eventLevel),
  });

  const eventColumns: ColumnProps<IotDeviceEvent>[] = [
    dateTimeColumn<IotDeviceEvent>('时间', 'reportedAt'),
    {
      title: '类型', dataIndex: 'kind', width: 100,
      render: (v: IotDeviceEvent['kind']) => (
        <Tag size="small" color={EVENT_KIND_COLORS[v]}>{IOT_DEVICE_EVENT_KIND_LABELS[v]}</Tag>
      ),
    },
    {
      title: '事件', width: 170,
      render: (_: unknown, r: IotDeviceEvent) => (
        <span>{r.name} <Text type="tertiary" size="small" code>{r.identifier}</Text></span>
      ),
    },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: IotDeviceEvent['level']) => (
        <Tag size="small" color={EVENT_LEVEL_COLORS[v]}>{IOT_EVENT_LEVEL_LABELS[v]}</Tag>
      ),
    },
    {
      title: '数据', dataIndex: 'payload',
      render: (v: Record<string, unknown> | null) => v && Object.keys(v).length > 0
        ? <Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{JSON.stringify(v)}</Text>
        : EMPTY_PLACEHOLDER,
    },
  ];

  // ─── 设备日志（五期）─────────────────────────────────────────────────────────
  const {
    page: logPage,
    pageSize: logPageSize,
    setPage: setLogPage,
    buildPagination: buildLogPagination,
  } = usePagination(10);
  const [logLevel, setLogLevel] = useState<string | undefined>();
  const logsQuery = useIotDeviceLogs(deviceId, {
    page: logPage,
    pageSize: logPageSize,
    level: enumValueOf(IOT_LOG_LEVELS, logLevel),
  });

  const logColumns: ColumnProps<IotDeviceLog>[] = [
    dateTimeColumn<IotDeviceLog>('时间', 'reportedAt'),
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: IotDeviceLog['level']) => (
        <Tag size="small" color={LOG_LEVEL_COLORS[v]}>{IOT_LOG_LEVEL_LABELS[v]}</Tag>
      ),
    },
    {
      title: '模块', dataIndex: 'tag', width: 100,
      render: (v: string | null) => v ? <Text size="small" code>{v}</Text> : EMPTY_PLACEHOLDER,
    },
    {
      title: '内容', dataIndex: 'content',
      render: (v: string) => (
        <Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 380, fontFamily: 'var(--semi-font-family-mono, monospace)' }}>{v}</Text>
      ),
    },
  ];

  // ─── 凭证 ────────────────────────────────────────────────────────────────────
  const resetSecretMutation = useResetIotDeviceSecret();

  function handleResetSecret() {
    if (!device) return;
    void resetSecretMutation.mutateAsync({ params: { id: device.id } }).then(() => {
      Toast.success('密钥已重置，请更新设备侧配置');
    });
  }

  const maskedSecret = device ? `${device.secret.slice(0, 8)}••••${device.secret.slice(-4)}` : '';
  const pendingDesiredCount = Object.keys(shadow?.desired ?? {}).length;

  return (
    <SideSheet
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {`设备详情 · ${device?.name ?? ''}`}
          <Tag size="small" color={wsConnected ? 'green' : 'grey'}>
            {wsConnected ? '实时' : '离线'}
          </Tag>
        </span>
      )}
      visible={device !== null}
      onCancel={onClose}
      width={820}
      closeOnEsc
      bodyStyle={{ paddingBottom: 24 }}
    >
      {device && (
        <>
          <Descriptions
            data={[
              { key: '设备 SN', value: <Text copyable>{device.sn}</Text> },
              {
                key: '接入密钥',
                value: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Text copyable={{ content: device.secret }}>{maskedSecret}</Text>
                    {hasPermission('iot:device:update') && (
                      <Popconfirm
                        title="确定要重置接入密钥吗？"
                        content="旧密钥立即失效，设备需使用新密钥重新签名"
                        onConfirm={handleResetSecret}
                      >
                        <Button size="small" theme="borderless" type="danger" loading={resetSecretMutation.isPending}>重置</Button>
                      </Popconfirm>
                    )}
                  </span>
                ),
              },
              { key: '所属产品', value: device.productName ?? EMPTY_PLACEHOLDER },
              { key: '固件版本', value: device.firmwareVersion ?? EMPTY_PLACEHOLDER },
              { key: '激活时间', value: device.activatedAt ?? EMPTY_PLACEHOLDER },
              { key: '最后在线', value: device.lastSeenAt ?? EMPTY_PLACEHOLDER },
            ]}
            row
            size="small"
          />
          <Banner
            type="info" closeIcon={null} style={{ margin: '12px 0' }}
            description={`设备侧以 HMAC-SHA256(secret, sn + 时间戳 + 请求体) 签名调用 ${iotIngestContract.basePath}/*，或携带同款签名参数连接 /api/iot/ws 获得指令与期望属性实时推送。`}
          />

          {/* lazyRender：拓扑等重型 Tab 首次激活才挂载（避免在隐藏容器中初始化 ReactFlow 导致 fitView 失效） */}
          <Tabs type="line" collapsible="auto" lazyRender>
            <TabPane tab="属性状态" itemKey="properties">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
                <Text type="tertiary" size="small">
                  reported 为设备最新上报快照；期望值下发后待设备回报一致自动收敛{shadow?.desiredAt ? `（最近下发 ${shadow.desiredAt}）` : ''}
                </Text>
                {canCommand && pendingDesiredCount > 0 && (
                  <Popconfirm
                    title="清空全部未确认的期望值？"
                    content="设备将不再收到这些期望变更"
                    onConfirm={() => {
                      if (deviceId) {
                        void clearDesiredMutation.mutateAsync({ params: { id: deviceId } }).then(() => Toast.success('期望值已清空'));
                      }
                    }}
                  >
                    <Button size="small" type="warning" theme="light">清空期望值（{pendingDesiredCount}）</Button>
                  </Popconfirm>
                )}
              </div>
              <Table
                columns={propertyColumns}
                dataSource={propertyRows}
                rowKey="key"
                size="small"
                pagination={false}
                loading={shadowQuery.isPending || modelQuery.isPending}
                empty="物模型未声明属性，且暂无上报数据"
              />
            </TabPane>

            <TabPane tab="遥测曲线" itemKey="telemetry">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0', flexWrap: 'wrap', gap: 8 }}>
                <RadioGroup type="button" buttonSize="small" value={days} onChange={(e) => setDays(e.target.value as number)}>
                  <Radio value={1}>近 24 时</Radio>
                  <Radio value={7}>近 7 天</Radio>
                  <Radio value={30}>近 30 天</Radio>
                </RadioGroup>
                <RadioGroup type="button" buttonSize="small" value={activeMetric ?? ''} onChange={(e) => setMetricKey(e.target.value as string)}>
                  {metricKeys.map((k) => {
                    const prop = model?.properties.find((p) => p.identifier === k);
                    return <Radio key={k} value={k}>{prop?.name ?? k}</Radio>;
                  })}
                </RadioGroup>
              </div>
              <Spin spinning={chartLoading}>
                {chartEmpty
                  ? <EmptyChart height={260} text="时间窗内暂无数值遥测" />
                  : useAgg
                    ? <LineChart {...aggSpec} options={chartOptions} height={260} />
                    : <AreaChart {...chartSpec} options={chartOptions} height={260} />}
              </Spin>
              {useAgg && (
                <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                  长窗口展示每小时聚合（最高 / 均值 / 最低），近 24 时展示原始点位。
                </Text>
              )}
            </TabPane>

            {canCommand && (
              <TabPane tab="指令下发" itemKey="commands">
                {services.length === 0 ? (
                  <Banner type="warning" closeIcon={null} style={{ margin: '8px 0' }}
                    description="产品物模型尚未声明服务；请先在产品管理的「物模型」中定义服务。" />
                ) : (
                  <div style={{ margin: '8px 0', padding: 12, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: (activeService?.params?.length ?? 0) > 0 ? 8 : 0 }}>
                      <Select
                        value={activeService?.identifier}
                        onChange={(v) => setServiceId(v as string)}
                        style={{ width: 260 }}
                        optionList={services.map((s) => ({
                          value: s.identifier,
                          label: `${s.name}（${s.identifier}）${s.danger ? ' ⚠' : ''}`,
                        }))}
                      />
                      <Button
                        theme="solid"
                        type={activeService?.danger ? 'danger' : 'primary'}
                        loading={sendCommandMutation.isPending}
                        onClick={() => void handleSendCommand()}
                      >
                        下发
                      </Button>
                    </div>
                    {activeService?.description && (
                      <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 4 }}>{activeService.description}</Text>
                    )}
                    {(activeService?.params?.length ?? 0) > 0 && (
                      <Form
                        key={activeService!.identifier}
                        labelPosition="left"
                        labelWidth={130}
                        getFormApi={(api) => setCommandFormApi(api)}
                      >
                        {activeService!.params.map((p) => <DefField key={p.identifier} def={p} />)}
                      </Form>
                    )}
                  </div>
                )}
                <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
                  设备 WS 在线时即时推送；离线设备在上线或心跳时补收，超时未回执自动标记「已超时」。
                </Text>
                <Table
                  columns={commandColumns}
                  dataSource={commandsQuery.data?.list ?? []}
                  rowKey="id"
                  size="small"
                  loading={commandsQuery.isFetching}
                  empty="暂无指令记录"
                  pagination={buildCommandPagination(commandsQuery.data?.total ?? 0)}
                />
              </TabPane>
            )}

            <TabPane tab="事件" itemKey="events">
              <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
                <FilterSelect
                  placeholder="全部类型"
                  items={IOT_DEVICE_EVENT_KIND_OPTIONS}
                  value={eventKind}
                  onChange={(v) => { setEventKind(v); setEventPage(1); }}
                  width={140}
                />
                <FilterSelect
                  placeholder="全部级别"
                  items={IOT_EVENT_LEVEL_OPTIONS}
                  value={eventLevel}
                  onChange={(v) => { setEventLevel(v); setEventPage(1); }}
                  width={140}
                />
              </div>
              <Table
                columns={eventColumns}
                dataSource={eventsQuery.data?.list ?? []}
                rowKey="id"
                size="small"
                loading={eventsQuery.isFetching}
                empty="暂无设备事件"
                pagination={buildEventPagination(eventsQuery.data?.total ?? 0)}
              />
            </TabPane>

            <TabPane tab="设备日志" itemKey="logs">
              <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
                <FilterSelect
                  placeholder="全部级别"
                  items={IOT_LOG_LEVEL_OPTIONS}
                  value={logLevel}
                  onChange={(v) => { setLogLevel(v); setLogPage(1); }}
                  width={140}
                />
              </div>
              <Table
                columns={logColumns}
                dataSource={logsQuery.data?.list ?? []}
                rowKey="id"
                size="small"
                loading={logsQuery.isFetching}
                empty={`暂无设备日志（设备侧通过 log 帧 / POST ${iotIngestContract.logs.fullPath} 上报）`}
                pagination={buildLogPagination(logsQuery.data?.total ?? 0)}
              />
            </TabPane>

            {device.nodeType === 'gateway' && (
              <TabPane tab={`拓扑（${device.subDeviceCount ?? 0}）`} itemKey="topology">
                <div style={{ marginTop: 8 }}>
                  <IotTopologyView deviceId={device.id} />
                </div>
              </TabPane>
            )}
          </Tabs>

          {/* 单属性期望值下发 */}
          <AppModal
            title={desiredTarget ? `下发期望值 · ${desiredTarget.name}` : ''}
            visible={desiredTarget !== null}
            onCancel={() => setDesiredTarget(null)}
            onOk={handleSetDesired}
            okButtonProps={{ loading: setDesiredMutation.isPending }}
            width={480}
            closeOnEsc
          >
            {desiredTarget && (
              <Form
                key={desiredTarget.identifier}
                labelPosition="left"
                labelWidth={130}
                getFormApi={(api) => setDesiredFormApi(api)}
                initValues={{
                  [desiredTarget.identifier]:
                    shadow?.desired?.[desiredTarget.identifier] ?? shadow?.reported?.[desiredTarget.identifier],
                }}
              >
                <DefField def={{
                  identifier: desiredTarget.identifier,
                  name: desiredTarget.name,
                  dataType: desiredTarget.dataType,
                  required: true,
                  unit: desiredTarget.unit,
                  minValue: desiredTarget.minValue,
                  maxValue: desiredTarget.maxValue,
                  enumOptions: desiredTarget.enumOptions,
                }} />
                <Text type="tertiary" size="small">
                  WS 在线即时推送；HTTP 设备下次心跳时收到。设备回报一致后该期望值自动清除。
                </Text>
              </Form>
            )}
          </AppModal>
        </>
      )}
    </SideSheet>
  );
}

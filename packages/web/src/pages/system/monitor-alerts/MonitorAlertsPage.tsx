import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Form, Input, Space, Spin, Toast, Modal, Switch, Tag, Row, Col,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { MonitorAlertRule, MonitorMetric, PaginatedResponse } from '@zenith/shared';

const METRIC_LABELS: Record<MonitorMetric, string> = {
  cpu: 'CPU 使用率', memory: '内存使用率', disk: '磁盘使用率', swap: 'Swap 使用率',
  load1: '系统负载(1m)', procCpu: '进程 CPU', heap: '堆内存使用率', loopLag: '事件循环延迟',
  qps: '请求 QPS', errorRate: 'HTTP 错误率', netRxBps: '网络下行', netTxBps: '网络上行',
  diskReadBps: '磁盘读取', diskWriteBps: '磁盘写入',
  workflowHealth: '流程引擎健康分', workflowBacklog: '流程引擎队列积压',
};
const METRIC_OPTIONS = (Object.keys(METRIC_LABELS) as MonitorMetric[]).map((v) => ({ value: v, label: METRIC_LABELS[v] }));
const PERCENT_METRICS = new Set<MonitorMetric>(['cpu', 'memory', 'disk', 'swap', 'heap', 'procCpu', 'errorRate']);
const BYTES_METRICS = new Set<MonitorMetric>(['netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps']);

const OP_SYMBOL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
const OP_OPTIONS = [
  { value: 'gt', label: '大于 >' }, { value: 'gte', label: '大于等于 ≥' },
  { value: 'lt', label: '小于 <' }, { value: 'lte', label: '小于等于 ≤' },
];
const LEVEL_CONFIG: Record<string, { label: string; color: 'blue' | 'amber' | 'red' }> = {
  info: { label: '提示', color: 'blue' }, warning: { label: '警告', color: 'amber' }, critical: { label: '严重', color: 'red' },
};
const CHANNEL_LABELS: Record<string, string> = { email: '邮件', webhook: 'Webhook', inapp: '站内' };

function metricUnit(metric: MonitorMetric): string {
  if (PERCENT_METRICS.has(metric)) return '%';
  if (metric === 'loopLag') return ' ms';
  return '';
}

function formatThreshold(metric: MonitorMetric, value: number): string {
  if (BYTES_METRICS.has(metric)) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = value; let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${Math.round(v * 10) / 10} ${units[i]}`;
  }
  return `${value}${metricUnit(metric)}`;
}

export default function MonitorAlertsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [data, setData] = useState<PaginatedResponse<MonitorAlertRule> | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<MonitorAlertRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const canManage = hasPermission('system:monitor:alert:manage');

  const fetchRules = useCallback(async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res = await request.get<PaginatedResponse<MonitorAlertRule>>(`/api/monitor-alerts?page=${p}&pageSize=${ps}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (data?.list ?? []).filter((r) => !keyword || r.name.toLowerCase().includes(keyword.toLowerCase()));

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }
  function openEdit(record: MonitorAlertRule) {
    setEditing(record);
    setModalVisible(true);
  }
  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const formInitValues = editing
    ? {
        name: editing.name, metric: editing.metric, operator: editing.operator, threshold: editing.threshold,
        durationMinutes: editing.durationMinutes, level: editing.level, channels: editing.channels,
        webhookUrl: editing.webhookUrl ?? '', recipients: editing.recipients, silenceMinutes: editing.silenceMinutes,
        enabled: editing.enabled,
      }
    : { operator: 'gt', level: 'warning', channels: ['inapp'], durationMinutes: 0, silenceMinutes: 30, enabled: true, recipients: [] };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = await formApi.current?.validate() as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    setSubmitting(true);
    try {
      const body = { ...values, webhookUrl: (values.webhookUrl as string) || null };
      const res = editing
        ? await request.put(`/api/monitor-alerts/${editing.id}`, body)
        : await request.post('/api/monitor-alerts', body);
      if (res.code === 0) {
        Toast.success(editing ? '更新成功' : '创建成功');
        closeModal();
        void fetchRules();
      } else {
        throw new Error(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/monitor-alerts/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchRules();
    }
  }

  function handleToggle(record: MonitorAlertRule, checked: boolean) {
    const run = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        const res = await request.patch(`/api/monitor-alerts/${record.id}/enabled`, { enabled: checked });
        if (res.code === 0) {
          Toast.success(checked ? '已启用' : '已停用');
          void fetchRules();
        }
      } finally {
        setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
      }
    };
    void run();
  }

  const columns: ColumnProps<MonitorAlertRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 180, fixed: 'left' },
    {
      title: '触发条件',
      dataIndex: 'metric',
      width: 230,
      render: (_: unknown, r: MonitorAlertRule) => (
        <span>
          <Tag size="small" type="ghost">{METRIC_LABELS[r.metric] ?? r.metric}</Tag>
          {' '}{OP_SYMBOL[r.operator] ?? r.operator}{' '}
          <b>{formatThreshold(r.metric, r.threshold)}</b>
          {r.durationMinutes > 0 ? <span style={{ color: 'var(--semi-color-text-2)' }}> · 持续{r.durationMinutes}分</span> : null}
        </span>
      ),
    },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: string) => <Tag color={LEVEL_CONFIG[v]?.color ?? 'grey'} size="small">{LEVEL_CONFIG[v]?.label ?? v}</Tag>,
    },
    {
      title: '通知渠道', dataIndex: 'channels', width: 160,
      render: (chs: string[]) => chs?.length ? <Space spacing={4}>{chs.map((c) => <Tag key={c} size="small" type="light">{CHANNEL_LABELS[c] ?? c}</Tag>)}</Space> : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '当前值', dataIndex: 'lastValue', width: 100,
      render: (v: number | null, r: MonitorAlertRule) => v === null ? '—' : formatThreshold(r.metric, v),
    },
    {
      title: '最近触发', dataIndex: 'lastTriggeredAt', width: 160,
      render: (t: string | null) => t ? formatDateTime(t) : <span style={{ color: 'var(--semi-color-text-2)' }}>从未</span>,
    },
    {
      title: '状态', dataIndex: 'state', width: 130, fixed: 'right',
      render: (state: string, r: MonitorAlertRule) => (
        <Space spacing={6}>
          {state === 'firing'
            ? <Tag color="red" size="small">告警中</Tag>
            : <Tag color="green" size="small">正常</Tag>}
          <Switch
            checked={r.enabled}
            loading={togglingIds.has(r.id)}
            disabled={!canManage}
            onChange={(c) => handleToggle(r, c)}
            size="small"
          />
        </Space>
      ),
    },
    createOperationColumn<MonitorAlertRule>({
      width: 120,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canManage,
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该规则吗？',
              content: '删除后不可恢复',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索规则名称..."
              value={keyword}
              onChange={setKeyword}
              showClear
              style={{ width: 220 }}
            />
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); void fetchRules(); }}>重置</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索规则名称..."
              value={keyword}
              onChange={setKeyword}
              showClear
              style={{ width: 220 }}
            />
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
          </>
        )}
        mobileActions={(
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); void fetchRules(); }}>重置</Button>
        )}
        actionTitle="告警规则操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={filtered}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无告警规则"
        onRefresh={() => void fetchRules()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchRules)}
      />

      <AppModal
        title={editing ? '编辑告警规则' : '新增告警规则'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
        width={660}
        closeOnEsc
      >
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editing?.id ?? 'new'}
            getFormApi={(api) => { formApi.current = api; }}
            allowEmpty
            initValues={formInitValues}
            labelPosition="left"
            labelWidth={90}
          >
            <Form.Input field="name" label="规则名称" placeholder="如：CPU 使用率过高" rules={[{ required: true, message: '请输入规则名称' }]} />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="metric" label="监控指标" style={{ width: '100%' }} optionList={METRIC_OPTIONS} rules={[{ required: true, message: '请选择指标' }]} />
              </Col>
              <Col span={12}>
                <Form.Select field="operator" label="比较符" style={{ width: '100%' }} optionList={OP_OPTIONS} rules={[{ required: true }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="threshold" label="阈值" style={{ width: '100%' }} placeholder="百分比填 0-100，吞吐填字节/秒" rules={[{ required: true, message: '请输入阈值' }]} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="durationMinutes" label="持续达标" min={0} max={1440} suffix="分钟" style={{ width: '100%' }} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="level" label="告警级别" style={{ width: '100%' }} optionList={Object.entries(LEVEL_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="silenceMinutes" label="静默期" min={0} max={10080} suffix="分钟" style={{ width: '100%' }} />
              </Col>
            </Row>
            <Form.Select field="channels" label="通知渠道" multiple style={{ width: '100%' }} optionList={Object.entries(CHANNEL_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            <Form.Input field="webhookUrl" label="Webhook" placeholder="https://example.com/webhook（选 Webhook 渠道时必填）" />
            <Form.TagInput field="recipients" label="收件邮箱" placeholder="输入邮箱后回车，可多个" style={{ width: '100%' }} />
            <Form.Switch field="enabled" label="启用" />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}

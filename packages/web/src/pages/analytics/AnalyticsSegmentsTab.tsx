/**
 * 行为中心阶段 1：用户分群 CRUD + 成员物化（异步任务）+ 成员明细查看。
 */
import { useMemo, useState } from 'react';
import { listTableProps } from '@/components/list-page';
import { useQueryClient } from '@tanstack/react-query';
import { Button, InputNumber, Input, Select, SideSheet, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, Trash2 } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import {
  analyticsKeys,
  useAnalyticsSegmentMembers,
  useAnalyticsSegments,
  useCampaigns,
  useCreateCampaign,
  useDeleteCampaign,
  useExecuteCampaign,
  useDeleteAnalyticsSegment,
  useMaterializeAnalyticsSegment,
  useSaveAnalyticsSegment,
} from '@/hooks/queries/analytics';
import { useEmailTemplateList } from '@/hooks/queries/email-templates';
import { useInAppTemplateList } from '@/hooks/queries/in-app-templates';
import { useSmsTemplateList } from '@/hooks/queries/sms-templates';
import type { AnalyticsSegmentAttributeCondition, AnalyticsSegmentCompareOp, AnalyticsSegmentCondition, AnalyticsSegmentEventCondition, AnalyticsSegmentMember, AnalyticsSegmentCampaign, AnalyticsSegmentPropertyFilter, AnalyticsUserSegment } from '@zenith/shared/analytics';
import { ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS, ANALYTICS_CAMPAIGN_CHANNEL_OPTIONS, ANALYTICS_CAMPAIGN_STATUS_LABELS, ANALYTICS_IDENTITY_TYPE_OPTIONS, ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS } from '@zenith/shared/analytics';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const PAGE_SIZE = 20;
const MAX_CONDITIONS = 10;

interface SegmentFilter {
  keyword: string;
  status?: 'enabled' | 'disabled';
}
const defaultFilter: SegmentFilter = { keyword: '', status: undefined };

interface PropertyFilterDraft {
  id: string;
  key: string;
  op: AnalyticsSegmentCompareOp;
  value: string;
}

interface ConditionDraft {
  id: string;
  type: 'event' | 'attribute';
  eventName: string;
  days: number;
  minCount?: number;
  properties: PropertyFilterDraft[];
  field: string;
  op: AnalyticsSegmentCompareOp;
  value: string;
}

function newProperty(): PropertyFilterDraft {
  return { id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, key: '', op: 'eq', value: '' };
}

function newCondition(type: ConditionDraft['type'] = 'event'): ConditionDraft {
  return {
    id: `cond-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    eventName: '',
    days: 30,
    properties: [],
    field: 'identityType',
    op: 'eq',
    value: '',
  };
}

function conditionToDraft(condition: AnalyticsSegmentCondition): ConditionDraft {
  if (condition.type === 'event') {
    return {
      id: `cond-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'event',
      eventName: condition.eventName,
      days: condition.days,
      minCount: condition.minCount,
      properties: (condition.properties ?? []).map((p) => ({ id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, key: p.key, op: p.op, value: String(p.value ?? '') })),
      field: 'identityType',
      op: 'eq',
      value: '',
    };
  }
  return {
    id: `cond-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'attribute',
    eventName: '',
    days: 30,
    properties: [],
    field: condition.field,
    op: condition.op,
    value: String(condition.value ?? ''),
  };
}

function draftToCondition(draft: ConditionDraft): AnalyticsSegmentCondition | null {
  if (draft.type === 'event') {
    const eventName = draft.eventName.trim();
    if (!eventName) return null;
    const properties: AnalyticsSegmentPropertyFilter[] = draft.properties
      .filter((p) => p.key.trim())
      .map((p) => ({ key: p.key.trim(), op: p.op, value: p.op === 'in' ? p.value.split(',').map((v) => v.trim()).filter(Boolean) : p.value }));
    const condition: AnalyticsSegmentEventCondition = {
      type: 'event',
      eventName,
      days: draft.days,
      minCount: draft.minCount,
      properties: properties.length ? properties : undefined,
    };
    return condition;
  }
  const field = draft.field.trim();
  if (!field) return null;
  const condition: AnalyticsSegmentAttributeCondition = {
    type: 'attribute',
    field,
    op: draft.op,
    value: draft.op === 'in' ? draft.value.split(',').map((v) => v.trim()).filter(Boolean) : draft.value,
  };
  return condition;
}

const ATTRIBUTE_FIELD_OPTIONS = [
  { label: '身份类型（identityType）', value: 'identityType' },
  { label: '管理员用户 ID（userId）', value: 'userId' },
  { label: '会员 ID（memberId）', value: 'memberId' },
];

function CampaignDrawer({ segment, onClose }: { segment: AnalyticsUserSegment; onClose: () => void }) {
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<AnalyticsSegmentCampaign['channel']>('email');
  const [templateId, setTemplateId] = useState<number | undefined>();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [landingUrl, setLandingUrl] = useState('');
  const campaignsQuery = useCampaigns({ page: 1, pageSize: 50, segmentId: segment.id }, true, 3000);
  const emailTemplatesQuery = useEmailTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, channel === 'email');
  const inAppTemplatesQuery = useInAppTemplateList({ page: 1, pageSize: 100, status: 'enabled' });
  const smsTemplatesQuery = useSmsTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, channel === 'sms');
  const createCampaign = useCreateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const executeCampaign = useExecuteCampaign();
  const templateOptions = (channel === 'email'
    ? emailTemplatesQuery.data?.list
    : channel === 'sms'
      ? smsTemplatesQuery.data?.list
      : inAppTemplatesQuery.data?.list)?.map((tpl) => ({ label: tpl.name, value: tpl.id })) ?? [];

  const handleCreate = async () => {
    if (!name.trim()) { Toast.warning('请输入触达名称'); return; }
    if (channel !== 'webhook' && !templateId) { Toast.warning('请选择模板'); return; }
    if (channel === 'webhook' && !/^https?:\/\/.+/i.test(webhookUrl)) { Toast.warning('请输入 http/https Webhook URL'); return; }
    if (landingUrl && !/^https?:\/\/.+/i.test(landingUrl)) { Toast.warning('落地页必须是 http/https 地址'); return; }
    await createCampaign.mutateAsync({
      body: {
        segmentId: segment.id,
        name: name.trim(),
        channel,
        templateId: channel === 'webhook' ? null : templateId,
        webhookUrl: channel === 'webhook' ? webhookUrl.trim() : null,
        landingUrl: channel === 'webhook' ? null : (landingUrl.trim() || null),
      },
    });
    Toast.success('触达活动已创建');
    setName('');
    setTemplateId(undefined);
    setWebhookUrl('');
    setLandingUrl('');
  };

  const columns: ColumnProps<AnalyticsSegmentCampaign>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 160 },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: AnalyticsSegmentCampaign['channel']) => ANALYTICS_CAMPAIGN_CHANNEL_OPTIONS.find((o) => o.value === v)?.label ?? v },
    { title: '计数', width: 140, render: (_: unknown, r: AnalyticsSegmentCampaign) => `${r.sentCount}/${r.totalCount}（失败 ${r.failedCount}）` },
    {
      title: '短链点击', width: 110,
      render: (_: unknown, r: AnalyticsSegmentCampaign) => r.shortUrl
        ? <Typography.Text copyable={{ content: r.shortUrl }}>{r.clickCount ?? 0}</Typography.Text>
        : (r.landingUrl ? <Typography.Text type="tertiary">待执行</Typography.Text> : EMPTY_PLACEHOLDER),
    },
    dateTimeColumn('最近执行', 'lastRunAt'),
    // 固定列必须连续贴在两端：状态若夹在中间，会被抽到右侧固定层，原位留下空洞，表头表体错位
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: AnalyticsSegmentCampaign['status']) => <Tag color={v === 'completed' ? 'green' : v === 'failed' ? 'red' : v === 'running' ? 'orange' : 'grey'} size="small">{ANALYTICS_CAMPAIGN_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<AnalyticsSegmentCampaign>({
      width: 120,
      desktopInlineKeys: ['execute'],
      actions: (record) => [
        { key: 'execute', label: '执行', loading: executeCampaign.isPending, disabledReason: record.status === 'running' ? '执行中' : undefined, onClick: async () => { await executeCampaign.mutateAsync({ params: { id: record.id } }); Toast.success('触达任务已提交'); } },
        { key: 'delete', label: '删除', danger: true, disabledReason: record.status === 'running' ? '执行中不可删' : undefined, onClick: () => { confirmDelete({ title: `确定删除触达「${record.name}」吗？`, onOk: () => deleteCampaign.mutateAsync({ params: { id: record.id } }) }); } },
      ],
    }),
  ];

  return (
    <SideSheet title={`分群触达 · ${segment.name}`} visible onCancel={onClose} width={900}>
      <div style={{ display: 'grid', gap: 12 }}>
        <SearchToolbar>
          <Input placeholder="触达名称" value={name} onChange={setName} style={{ width: 180 }} />
          <Select value={channel} optionList={ANALYTICS_CAMPAIGN_CHANNEL_OPTIONS} onChange={(v) => { setChannel(v as AnalyticsSegmentCampaign['channel']); setTemplateId(undefined); }} style={{ width: 130 }} />
          {channel === 'webhook' ? (
            <Input placeholder="https://example.com/webhook" value={webhookUrl} onChange={setWebhookUrl} style={{ width: 300 }} />
          ) : (
            <>
              <Select
                placeholder="选择模板" value={templateId} optionList={templateOptions}
                onChange={(v) => setTemplateId(v as number)}
                loading={channel === 'email' ? emailTemplatesQuery.isFetching : channel === 'sms' ? smsTemplatesQuery.isFetching : inAppTemplatesQuery.isFetching}
                style={{ width: 200 }}
              />
              <Tooltip content="选填。执行时自动生成短链（可在运营中心统一治理），模板内用 {{shortUrl}} 引用，点击数据回流到本活动">
                <Input placeholder="落地页 URL（选填，自动转短链）" value={landingUrl} onChange={setLandingUrl} style={{ width: 250 }} />
              </Tooltip>
            </>
          )}
          <CreateButton onClick={() => void handleCreate()} loading={createCampaign.isPending} />
        </SearchToolbar>
        <ConfigurableTable



          columns={columns}



          empty="暂无触达活动"
        {...listTableProps(campaignsQuery)}
      />
      </div>
    </SideSheet>
  );
}

export default function AnalyticsSegmentsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SegmentFilter>(defaultFilter);
  const [submittedFilter, setSubmittedFilter] = useState<SegmentFilter>(defaultFilter);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<AnalyticsUserSegment | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'enabled' | 'disabled'>('enabled');
  const [operator, setOperator] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<ConditionDraft[]>([newCondition()]);

  const [membersSegment, setMembersSegment] = useState<AnalyticsUserSegment | null>(null);
  const [campaignSegment, setCampaignSegment] = useState<AnalyticsUserSegment | null>(null);
  const [membersPage, setMembersPage] = useState(1);
  const [membersPageSize, setMembersPageSize] = useState(PAGE_SIZE);

  const segmentsQuery = useAnalyticsSegments({
    page,
    pageSize,
    keyword: submittedFilter.keyword || undefined,
    status: submittedFilter.status || undefined,
  });
  const segments = segmentsQuery.data?.list ?? [];
  const total = segmentsQuery.data?.total ?? 0;

  const saveMutation = useSaveAnalyticsSegment();
  const deleteMutation = useDeleteAnalyticsSegment();
  const materializeMutation = useMaterializeAnalyticsSegment();

  const membersQuery = useAnalyticsSegmentMembers(
    membersSegment?.id,
    { page: membersPage, pageSize: membersPageSize },
    membersSegment != null,
  );
  const members = membersQuery.data?.list ?? [];
  const membersTotal = membersQuery.data?.total ?? 0;

  const handleSearch = () => {
    setPage(1);
    setSubmittedFilter(filter);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.segmentsLists });
  };
  const handleReset = () => {
    setFilter(defaultFilter);
    setSubmittedFilter(defaultFilter);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.segmentsLists });
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setStatus('enabled');
    setOperator('AND');
    setConditions([newCondition()]);
    setModalVisible(true);
  };

  const openEdit = (record: AnalyticsUserSegment) => {
    setEditing(record);
    setName(record.name);
    setDescription(record.description ?? '');
    setStatus(record.status);
    setOperator(record.rules.operator);
    setConditions(record.rules.conditions.length ? record.rules.conditions.map(conditionToDraft) : [newCondition()]);
    setModalVisible(true);
  };

  const updateCondition = (id: string, patch: Partial<ConditionDraft>) => {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const addCondition = () => {
    setConditions((prev) => (prev.length >= MAX_CONDITIONS ? prev : [...prev, newCondition()]));
  };
  const removeCondition = (id: string) => {
    setConditions((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  };
  const addProperty = (conditionId: string) => {
    setConditions((prev) => prev.map((c) => (c.id === conditionId ? { ...c, properties: c.properties.length >= 5 ? c.properties : [...c.properties, newProperty()] } : c)));
  };
  const updateProperty = (conditionId: string, propertyId: string, patch: Partial<PropertyFilterDraft>) => {
    setConditions((prev) => prev.map((c) => (c.id === conditionId ? { ...c, properties: c.properties.map((p) => (p.id === propertyId ? { ...p, ...patch } : p)) } : c)));
  };
  const removeProperty = (conditionId: string, propertyId: string) => {
    setConditions((prev) => prev.map((c) => (c.id === conditionId ? { ...c, properties: c.properties.filter((p) => p.id !== propertyId) } : c)));
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { Toast.warning('请输入分群名称'); return; }
    const compiledConditions = conditions.map(draftToCondition).filter((c): c is AnalyticsSegmentCondition => c !== null);
    if (compiledConditions.length === 0) { Toast.warning('请至少配置一条有效条件'); return; }
    const values = {
      name: trimmedName,
      description: description.trim() || null,
      status,
      rules: { operator, conditions: compiledConditions },
    };
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleDelete = async (record: AnalyticsUserSegment) => {
    await deleteMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('删除成功');
  };

  const handleMaterialize = async (record: AnalyticsUserSegment) => {
    await materializeMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('重算任务已提交，可在顶部任务中心查看进度');
  };

  const columns: ColumnProps<AnalyticsUserSegment>[] = useMemo(() => [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '描述', dataIndex: 'description', minWidth: 320, render: (v: string | null) => (v ? renderEllipsis(v) : EMPTY_PLACEHOLDER) },
    {
      title: '规则',
      dataIndex: 'rules',
      width: 100,
      render: (_: unknown, record: AnalyticsUserSegment) => <Tag color="blue" size="small">{record.rules.operator} · {record.rules.conditions.length} 条</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: AnalyticsUserSegment['status']) => (
        <Tag color={value === 'enabled' ? 'green' : 'grey'} size="small">
          {ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value}
        </Tag>
      ),
    },
    { title: '成员数（快照）', dataIndex: 'estimatedSize', width: 150, align: 'right' },
    dateTimeColumn('快照时间', 'snapshotAt', { empty: '未物化' }),
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<AnalyticsUserSegment>({
      width: 240,
      desktopInlineKeys: ['members', 'campaign', 'edit'],
      actions: (record) => [
        { key: 'members', label: '成员', onClick: () => { setMembersSegment(record); setMembersPage(1); } },
        { key: 'campaign', label: '触达', onClick: () => setCampaignSegment(record) },
        { key: 'materialize', label: '重算', loading: materializeMutation.isPending, onClick: () => handleMaterialize(record) },
        { key: 'edit', label: '编辑', onClick: () => openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定删除分群「${record.name}」吗？`,
              onOk: () => handleDelete(record),
            });
          },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [materializeMutation.isPending]);

  const memberColumns: ColumnProps<AnalyticsSegmentMember>[] = [
    { title: 'distinctId', dataIndex: 'distinctId' },
    { title: '身份类型', dataIndex: 'identityType', width: 100 },
    { title: '管理员 ID', dataIndex: 'userId', width: 100, render: (v: number | null) => v ?? '–' },
    { title: '会员 ID', dataIndex: 'memberId', width: 100, render: (v: number | null) => v ?? '–' },
    dateTimeColumn('快照时间', 'snapshotAt'),
  ];

  return (
    <div>
      <SearchToolbar>
        <KeywordInput placeholder="分群名称" value={filter.keyword} onChange={(value) => setFilter((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} width={200} />
        <StatusSelect
          items={ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS}
          value={filter.status}
          onChange={(value) => setFilter((prev) => ({ ...prev, status: value as SegmentFilter['status'] | undefined }))}
        />
        <SearchButton onClick={handleSearch} />
        <ResetButton onClick={handleReset} />
        <CreateButton onClick={openCreate} />
      </SearchToolbar>
      <ConfigurableTable
        bordered
        rowKey="id"
        loading={segmentsQuery.isFetching}
        columns={columns}
        dataSource={segments}
        onRefresh={() => void segmentsQuery.refetch()}
        refreshLoading={segmentsQuery.isFetching}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => setPage(p),
          onPageSizeChange: (ps) => { setPage(1); setPageSize(ps); },
        }}
        empty="暂无分群"
      />

      <AppModal
        title={editing ? '编辑用户分群' : '新增用户分群'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSubmit()}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={860}
        closeOnEsc
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '220px', ['--auto-grid-cols' as string]: 2, ['--auto-grid-gap' as string]: '12px' }}>
            <div>
              <Typography.Text type="tertiary" size="small">名称</Typography.Text>
              <Input value={name} onChange={setName} placeholder="如「近 7 天活跃用户」" />
            </div>
            <div>
              <Typography.Text type="tertiary" size="small">状态</Typography.Text>
              <Select value={status} optionList={ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS} onChange={(v) => setStatus(v as 'enabled' | 'disabled')} style={{ width: '100%' }} />
            </div>
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">描述</Typography.Text>
            <Input value={description} onChange={setDescription} placeholder="分群用途说明（可选）" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text type="tertiary" size="small">条件间关系</Typography.Text>
            <Select value={operator} optionList={[{ label: '全部满足（AND）', value: 'AND' }, { label: '任一满足（OR）', value: 'OR' }]} onChange={(v) => setOperator(v as 'AND' | 'OR')} style={{ width: 180 }} />
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {conditions.map((condition, index) => (
              <div key={condition.id} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag color="blue">#{index + 1}</Tag>
                  <Select
                    value={condition.type}
                    optionList={[{ label: '事件条件', value: 'event' }, { label: '属性条件', value: 'attribute' }]}
                    onChange={(v) => updateCondition(condition.id, { type: v as ConditionDraft['type'] })}
                    style={{ width: 140 }}
                  />
                  <div style={{ flex: 1 }} />
                  <Button icon={<Trash2 size={14} />} type="danger" theme="borderless" disabled={conditions.length <= 1} onClick={() => removeCondition(condition.id)} />
                </div>
                {condition.type === 'event' ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px', gap: 8 }}>
                      <Input placeholder="事件名，如 order_submit" value={condition.eventName} onChange={(v) => updateCondition(condition.id, { eventName: v })} />
                      <InputNumber prefix="近" suffix="天内" placeholder="30" value={condition.days} min={1} max={365} onChange={(v) => updateCondition(condition.id, { days: Number(v) || 30 })} />
                      <InputNumber prefix="≥" suffix="次" placeholder="1" value={condition.minCount} min={1} max={100000} onChange={(v) => updateCondition(condition.id, { minCount: v == null ? undefined : Number(v) })} />
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {condition.properties.map((prop) => (
                        <div key={prop.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr 32px', gap: 8 }}>
                          <Input placeholder="属性 key" value={prop.key} onChange={(v) => updateProperty(condition.id, prop.id, { key: v })} />
                          <Select value={prop.op} optionList={ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS} onChange={(v) => updateProperty(condition.id, prop.id, { op: v as AnalyticsSegmentCompareOp })} />
                          <Input placeholder="属性值（in 用逗号分隔）" value={prop.value} onChange={(v) => updateProperty(condition.id, prop.id, { value: v })} />
                          <Button icon={<Trash2 size={12} />} theme="borderless" type="danger" onClick={() => removeProperty(condition.id, prop.id)} />
                        </div>
                      ))}
                      <Button size="small" icon={<Plus size={12} />} disabled={condition.properties.length >= 5} onClick={() => addProperty(condition.id)}>添加属性过滤</Button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 1fr', gap: 8 }}>
                    <Select
                      placeholder="属性字段"
                      value={ATTRIBUTE_FIELD_OPTIONS.some((o) => o.value === condition.field) ? condition.field : 'custom'}
                      optionList={[...ATTRIBUTE_FIELD_OPTIONS, { label: '自定义 property.<key>', value: 'custom' }]}
                      onChange={(v) => updateCondition(condition.id, { field: v === 'custom' ? 'property.' : (v as string) })}
                    />
                    {(!ATTRIBUTE_FIELD_OPTIONS.some((o) => o.value === condition.field)) && (
                      <Input placeholder="property.key" value={condition.field} onChange={(v) => updateCondition(condition.id, { field: v })} />
                    )}
                    <Select value={condition.op} optionList={ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS} onChange={(v) => updateCondition(condition.id, { op: v as AnalyticsSegmentCompareOp })} />
                    <Input placeholder="值（in 用逗号分隔）" value={condition.value} onChange={(v) => updateCondition(condition.id, { value: v })} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button icon={<Plus size={14} />} disabled={conditions.length >= MAX_CONDITIONS} onClick={addCondition}>添加条件</Button>
          <Typography.Text type="tertiary" size="small">
            规则仅支持事件 / 属性两种原子条件的 AND / OR 组合，不支持分群嵌套；身份类型可选值参考：{ANALYTICS_IDENTITY_TYPE_OPTIONS.map((o) => o.label).join(' / ')}
          </Typography.Text>
        </div>
      </AppModal>

      <SideSheet
        title={membersSegment ? `分群成员 · ${membersSegment.name}` : '分群成员'}
        visible={membersSegment != null}
        onCancel={() => setMembersSegment(null)}
        width={640}
      >
        <ConfigurableTable
          bordered
          rowKey="id"
          loading={membersQuery.isFetching}
          columns={memberColumns}
          dataSource={members}
          pagination={{
            currentPage: membersPage,
            pageSize: membersPageSize,
            total: membersTotal,
            onPageChange: (p) => setMembersPage(p),
            onPageSizeChange: (ps) => { setMembersPage(1); setMembersPageSize(ps); },
          }}
          empty="尚未物化或暂无成员，请先点击「重算」"
        />
      </SideSheet>
      {campaignSegment && <CampaignDrawer segment={campaignSegment} onClose={() => setCampaignSegment(null)} />}
    </div>
  );
}

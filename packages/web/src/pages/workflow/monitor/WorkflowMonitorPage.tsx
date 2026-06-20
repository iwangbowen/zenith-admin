import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  SideSheet,
  Space,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Download, MoreHorizontal, RotateCcw, Search } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowCategory, WorkflowDefinition, WorkflowInstance, WorkflowTask } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowAnalyticsView from './WorkflowAnalyticsView';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft:     { text: '草稿',  color: 'grey'   },
  running:   { text: '审批中', color: 'blue'   },
  approved:  { text: '已通过', color: 'green'  },
  rejected:  { text: '已驳回', color: 'red'    },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

const RUNNING_STATUSES = new Set(['draft', 'running']);

/** 计算流程耗时：运行中算到当前，已结束算到最后更新时间 */
function formatDuration(start: string, end: string): string {
  let sec = Math.max(0, dayjs(end).diff(dayjs(start), 'second'));
  const d = Math.floor(sec / 86400); sec -= d * 86400;
  const h = Math.floor(sec / 3600); sec -= h * 3600;
  const m = Math.floor(sec / 60); sec -= m * 60;
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

interface MonitorStats {
  total: number;
  running: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  cancelled: number;
}

interface MonitorResponse {
  stats: MonitorStats;
  list: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

/** 状态统计卡片 */
function StatCard({
  label,
  value,
  color,
  onClick,
  active,
}: Readonly<{
  label: string;
  value: number;
  color: string;
  onClick: () => void;
  active: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        flex: 1,
        minWidth: 120,
        border: 'none',
        background: 'none',
        padding: 0,
        textAlign: 'left',
      }}
    >
      <Card
        style={{
          border: active ? `2px solid ${color}` : '2px solid transparent',
          transition: 'border-color 0.2s',
        }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
        <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      </Card>
    </button>
  );
}

export default function WorkflowMonitorPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MonitorResponse | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  interface SearchParams { keyword: string; initiator: string; status: string; categoryId: number | '' }
  const defaultSearchParams: SearchParams = { keyword: '', initiator: '', status: '', categoryId: '' };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const { categories } = useWorkflowCategories();
  const { hasPermission } = usePermission();
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailDef, setDetailDef] = useState<WorkflowDefinition | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);

  // 流程定义（用于数据分析筛选 + 强制跳转节点选择）
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  // 管理员：强制跳转
  const [jumpRecord, setJumpRecord] = useState<WorkflowInstance | null>(null);
  const [jumpNodes, setJumpNodes] = useState<Array<{ label: string; value: string }>>([]);
  const [jumpSubmitting, setJumpSubmitting] = useState(false);
  const jumpFormApi = useRef<FormApi | null>(null);
  // 管理员：改派处理人
  const [reassignRecord, setReassignRecord] = useState<WorkflowInstance | null>(null);
  const [reassignTasks, setReassignTasks] = useState<Array<{ label: string; value: number }>>([]);
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const reassignFormApi = useRef<FormApi | null>(null);

  const canAdmin = hasPermission('workflow:instance:cancel');

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword: kw, status: st, categoryId: cat, initiator: initKw } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (kw) qs.set('keyword', kw);
      if (st) qs.set('status', st);
      if (cat !== '') qs.set('categoryId', String(cat));
      if (initKw) qs.set('initiatorKeyword', initKw);
      const res = await request.get<MonitorResponse>(`/api/workflows/instances/all?${qs.toString()}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published')
      .then((res) => { if (res.code === 0 && res.data) setDefinitions(res.data); });
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
    void fetchList(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const handleStatCardClick = (st: string) => {
    const next = searchParams.status === st ? '' : st;
    const newParams = { ...searchParams, status: next };
    setSearchParams(newParams);
    setPage(1);
    void fetchList(1, pageSize, newParams);
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    const { keyword, status, categoryId, initiator } = searchParamsRef.current;
    const qs = new URLSearchParams();
    if (keyword) qs.set('keyword', keyword);
    if (status) qs.set('status', status);
    if (categoryId !== '') qs.set('categoryId', String(categoryId));
    if (initiator) qs.set('initiatorKeyword', initiator);
    setExporting(true);
    try {
      await request.download(`/api/workflows/instances/export?${qs.toString()}`, '流程实例.xlsx');
    } finally {
      setExporting(false);
    }
  };

  const loadDetail = (instanceId: number) => {
    setDetailLoading(true);
    setDetailDef(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)
      .then(res => {
        if (res.code === 0) {
          setDetail(res.data);
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`);
        }
        return null;
      })
      .then(defRes => { if (defRes?.code === 0) setDetailDef(defRes.data); })
      .finally(() => setDetailLoading(false));
    p.catch(() => undefined);
  };

  const openDetail = (item: WorkflowInstance) => {
    setDetailVisible(true);
    loadDetail(item.id);
  };

  const handleCancel = (record: WorkflowInstance) => {
    Modal.confirm({
      title: '取消流程',
      content: `确定要强制取消流程「${record.title}」吗？取消后流程将立即终止，待办任务会被跳过，此操作不可恢复。`,
      okText: '确定取消',
      okButtonProps: { type: 'warning', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        const res = await request.post(`/api/workflows/instances/${record.id}/cancel`);
        if (res.code === 0) {
          Toast.success('流程已取消');
          void fetchList();
        }
      },
    });
  };

  const handleDelete = (record: WorkflowInstance) => {
    Modal.confirm({
      title: '删除流程',
      content: `确定要删除流程「${record.title}」吗？删除后该流程及其审批记录将被永久移除，此操作不可恢复。`,
      okText: '确定删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        const res = await request.delete(`/api/workflows/instances/${record.id}`);
        if (res.code === 0) {
          Toast.success('流程已删除');
          void fetchList();
        }
      },
    });
  };

  const stats = data?.stats ?? { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0, cancelled: 0 };

  const loadUserOptions = useCallback(async () => {
    if (userOptions.length > 0) return;
    const res = await request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all');
    if (res.code === 0) setUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
  }, [userOptions.length]);

  const openJump = async (record: WorkflowInstance) => {
    setJumpRecord(record);
    setJumpNodes([]);
    const res = await request.get<WorkflowDefinition>(`/api/workflows/definitions/${record.definitionId}`);
    if (res.code === 0) {
      const nodes = (res.data.flowData?.nodes ?? [])
        .filter((n) => n.data.type === 'approve' || n.data.type === 'handler')
        .map((n) => ({ label: n.data.label ?? n.data.key, value: n.data.key }));
      setJumpNodes(nodes);
    }
  };

  const submitJump = async () => {
    if (!jumpRecord) return;
    try {
      const values = await jumpFormApi.current?.validate() as { targetNodeKey: string; comment?: string };
      setJumpSubmitting(true);
      const res = await request.post(`/api/workflows/instances/${jumpRecord.id}/jump`, values);
      if (res.code === 0) {
        Toast.success('已强制跳转');
        setJumpRecord(null);
        void fetchList();
      } else {
        Toast.error(res.message || '跳转失败');
      }
    } catch { /* validation */ } finally {
      setJumpSubmitting(false);
    }
  };

  const openReassign = async (record: WorkflowInstance) => {
    setReassignRecord(record);
    setReassignTasks([]);
    void loadUserOptions();
    const res = await request.get<WorkflowInstance>(`/api/workflows/instances/${record.id}`);
    if (res.code === 0) {
      const tasks = (res.data.tasks ?? [])
        .filter((t: WorkflowTask) => t.status === 'pending')
        .map((t: WorkflowTask) => ({ label: `${t.nodeName} · ${t.assigneeName ?? '未指派'}`, value: t.id }));
      setReassignTasks(tasks);
    }
  };

  const submitReassign = async () => {
    if (!reassignRecord) return;
    try {
      const values = await reassignFormApi.current?.validate() as { taskId: number; targetUserId: number; comment?: string };
      setReassignSubmitting(true);
      const res = await request.post(`/api/workflows/tasks/${values.taskId}/reassign`, { targetUserId: values.targetUserId, comment: values.comment });
      if (res.code === 0) {
        Toast.success('已改派');
        setReassignRecord(null);
        void fetchList();
      } else {
        Toast.error(res.message || '改派失败');
      }
    } catch { /* validation */ } finally {
      setReassignSubmitting(false);
    }
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 220,
      render: renderEllipsis,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: renderEllipsis,
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 110,
      render: (v: string | null) => v
        ? <Tag size="small" color="blue">{v}</Tag>
        : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '当前节点',
      dataIndex: 'currentNodeName',
      width: 130,
      render: (v: string | null | undefined) => v
        ? <Tag size="small" color="cyan">{v}</Tag>
        : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '申请人',
      dataIndex: 'initiatorName',
      width: 120,
      render: (v: string | null, record: WorkflowInstance) => (
        <Space spacing={6}>
          <UserAvatar name={v ?? '?'} avatar={record.initiatorAvatar} semiSize="extra-extra-small" size={20} />
          <span>{v ?? '—'}</span>
        </Space>
      ),
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 120,
      render: (_: unknown, record: WorkflowInstance) => {
        const end = RUNNING_STATUSES.has(record.status) ? dayjs().format('YYYY-MM-DD HH:mm:ss') : record.updatedAt;
        return <span style={{ color: 'var(--semi-color-text-1)' }}>{formatDuration(record.createdAt, end)}</span>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (v: string) => {
        const s = INSTANCE_STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => {
        const canCancel = hasPermission('workflow:instance:cancel') && record.status === 'running';
        const canDelete = hasPermission('workflow:instance:delete') && !RUNNING_STATUSES.has(record.status);
        const canJump = canAdmin && record.status === 'running';
        return (
          <Space>
            <Button theme="borderless" size="small" onClick={() => openDetail(record)}>详情</Button>
            {(canCancel || canDelete || canJump) && (
              <Dropdown
                trigger="click"
                position="bottomRight"
                render={(
                  <Dropdown.Menu>
                    {canJump && <Dropdown.Item onClick={() => void openJump(record)}>强制跳转</Dropdown.Item>}
                    {canJump && <Dropdown.Item onClick={() => void openReassign(record)}>改派处理人</Dropdown.Item>}
                    {canCancel && <Dropdown.Item type="warning" onClick={() => handleCancel(record)}>取消</Dropdown.Item>}
                    {canDelete && <Dropdown.Item type="danger" onClick={() => handleDelete(record)}>删除</Dropdown.Item>}
                  </Dropdown.Menu>
                )}
              >
                <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} />
              </Dropdown>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <Tabs type="line">
        <TabPane tab="实例监控" itemKey="list">
      {/* 统计卡片 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="全部" value={stats.total}     color="var(--semi-color-text-0)" onClick={() => handleStatCardClick('')}          active={searchParams.status === ''} />
        <StatCard label="审批中" value={stats.running}  color="var(--semi-color-primary)"        onClick={() => handleStatCardClick('running')}   active={searchParams.status === 'running'} />
        <StatCard label="已通过" value={stats.approved} color="#0dc87c"                          onClick={() => handleStatCardClick('approved')}  active={searchParams.status === 'approved'} />
        <StatCard label="已驳回" value={stats.rejected} color="#ff4d4f"                          onClick={() => handleStatCardClick('rejected')}  active={searchParams.status === 'rejected'} />
        <StatCard label="已撤回" value={stats.withdrawn ?? 0} color="var(--semi-color-warning)"  onClick={() => handleStatCardClick('withdrawn')} active={searchParams.status === 'withdrawn'} />
        <StatCard label="已取消" value={stats.cancelled ?? 0} color="#8b5cf6"                   onClick={() => handleStatCardClick('cancelled')} active={searchParams.status === 'cancelled'} />
      </div>

      {/* 搜索栏 */}
      <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索申请标题 / 流程名称"
            showClear
            value={searchParams.keyword}
            onChange={v => setSearchParams(prev => ({ ...prev, keyword: v }))}
            onEnterPress={handleSearch}
            style={{ width: 240 }}
          />
          <Select
            placeholder="所有分类"
            showClear
            value={searchParams.categoryId === '' ? undefined : searchParams.categoryId}
            onChange={v => setSearchParams(prev => ({ ...prev, categoryId: (v as number) ?? '' }))}
            style={{ width: 140 }}
            optionList={categories.map((c: WorkflowCategory) => ({ label: c.name, value: c.id }))}
          />
          <Input
            placeholder="申请人"
            showClear
            value={searchParams.initiator}
            onChange={v => setSearchParams(prev => ({ ...prev, initiator: v }))}
            onEnterPress={handleSearch}
            style={{ width: 120 }}
          />
          <Select
            placeholder="所有状态"
            showClear
            value={searchParams.status || undefined}
            onChange={v => setSearchParams(prev => ({ ...prev, status: (v as string) ?? '' }))}
            style={{ width: 140 }}
            optionList={[
              { label: '审批中', value: 'running' },
              { label: '已通过', value: 'approved' },
              { label: '已驳回', value: 'rejected' },
              { label: '已撤回', value: 'withdrawn' },
              { label: '已取消', value: 'cancelled' },
            ]}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          <Button type="primary" icon={<Download size={14} />} loading={exporting} onClick={() => void handleExport()}>导出</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        scroll={{ x: 1450 }}
        pagination={buildPagination(data?.total ?? 0, (p, ps) => void fetchList(p, ps))}
      />
        </TabPane>
        <TabPane tab="数据分析" itemKey="analytics">
          <WorkflowAnalyticsView definitions={definitions} />
        </TabPane>
      </Tabs>

      {/* 详情弹窗 */}
      <SideSheet
        title="流程详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetail(null); setDetailDef(null); }}
        width={760}
        bodyStyle={{ padding: 16 }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <WorkflowInstanceDetailPanel instance={detail} definition={detailDef} loading={detailLoading} onOpenInstance={loadDetail} />
        )}
      </SideSheet>

      {/* 管理员：强制跳转节点 */}
      <Modal
        title="强制跳转节点"
        visible={!!jumpRecord}
        onCancel={() => setJumpRecord(null)}
        onOk={() => void submitJump()}
        okButtonProps={{ loading: jumpSubmitting, type: 'warning', theme: 'solid' }}
        okText="确认跳转"
        closeOnEsc
        width={460}
      >
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 12 }}>
          将终止「{jumpRecord?.title}」当前所有待办任务，直接推进到所选审批节点。此操作不可恢复。
        </Typography.Text>
        <Form getFormApi={(api) => { jumpFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.Select field="targetNodeKey" label="目标节点" placeholder="请选择要跳转到的审批节点" optionList={jumpNodes} rules={[{ required: true, message: '请选择目标节点' }]} style={{ width: '100%' }} />
          <Form.TextArea field="comment" label="说明" placeholder="可选，记录跳转原因" rows={2} />
        </Form>
      </Modal>

      {/* 管理员：改派处理人 */}
      <Modal
        title="改派处理人"
        visible={!!reassignRecord}
        onCancel={() => setReassignRecord(null)}
        onOk={() => void submitReassign()}
        okButtonProps={{ loading: reassignSubmitting, type: 'primary' }}
        okText="确认改派"
        closeOnEsc
        width={460}
      >
        <Form getFormApi={(api) => { reassignFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.Select field="taskId" label="待办任务" placeholder="请选择要改派的待办" optionList={reassignTasks} rules={[{ required: true, message: '请选择待办任务' }]} style={{ width: '100%' }} />
          <Form.Select field="targetUserId" label="新处理人" placeholder="请选择新的处理人" filter optionList={userOptions} rules={[{ required: true, message: '请选择新处理人' }]} style={{ width: '100%' }} />
          <Form.TextArea field="comment" label="说明" placeholder="可选" rows={2} />
        </Form>
      </Modal>
    </div>
  );
}

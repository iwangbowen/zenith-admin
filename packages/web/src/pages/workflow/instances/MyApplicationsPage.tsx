import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Modal,
  Popconfirm,
  Select,
  SideSheet,
  Space,
  Spin,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import dayjs from 'dayjs';
import { FileInput, Plus, RotateCcw, Search } from 'lucide-react';
import type { WorkflowDefinition, WorkflowInstance, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePageTracker } from '@/hooks/usePageTracker';
import { trackFeature } from '@/utils/tracker';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import WorkflowNodeListView from '@/components/workflow/WorkflowNodeListView';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

function InstanceDetailDrawer({
  instanceId,
  visible,
  onClose,
  onRefresh,
}: Readonly<{
  instanceId: number | null;
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
}>) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowInstance | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);

  useEffect(() => {
    if (!visible || !instanceId) return;
    setLoading(true);
    setDefinition(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)
      .then(res => {
        if (res.code === 0) {
          setData(res.data);
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`);
        }
        return null;
      })
      .then(defRes => { if (defRes?.code === 0) setDefinition(defRes.data); })
      .finally(() => setLoading(false));
    p.catch(() => undefined);
  }, [visible, instanceId]);

  const handleWithdraw = async () => {
    if (!instanceId) return;
    const res = await request.post(`/api/workflows/instances/${instanceId}/withdraw`, {});
    if (res.code === 0) {
      Toast.success('已撤回');
      onRefresh();
      onClose();
    }
  };

  const [urgeVisible, setUrgeVisible] = useState(false);
  const [urgeMessage, setUrgeMessage] = useState('');
  const [urgeLoading, setUrgeLoading] = useState(false);
  const handleUrge = async () => {
    if (!instanceId) return;
    setUrgeLoading(true);
    try {
      const res = await request.post<unknown>(`/api/workflows/instances/${instanceId}/urge`, { message: urgeMessage || undefined });
      if (res.code === 0) {
        Toast.success(res.message || '已催办');
        setUrgeVisible(false);
        setUrgeMessage('');
      } else if (res.code === 429) {
        Toast.warning(res.message);
      }
    } finally {
      setUrgeLoading(false);
    }
  };

  // 动态补加抄送
  const ccNodeOptions = (definition?.flowData?.nodes ?? [])
    .filter((n) => n.data.type === 'ccNode')
    .map((n) => ({ label: n.data.label, value: n.data.key }));
  const [ccVisible, setCcVisible] = useState(false);
  const [ccNodeKey, setCcNodeKey] = useState<string | undefined>(undefined);
  const [ccUserIds, setCcUserIds] = useState<number[]>([]);
  const [ccUserOptions, setCcUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const [ccLoading, setCcLoading] = useState(false);
  const openCcModal = async () => {
    setCcNodeKey(ccNodeOptions[0]?.value);
    setCcUserIds([]);
    setCcVisible(true);
    if (ccUserOptions.length === 0) {
      try {
        const res = await request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all');
        if (res.code === 0) {
          setCcUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
        }
      } catch { /* ignore */ }
    }
  };
  const handleAddCc = async () => {
    if (!instanceId || !ccNodeKey || ccUserIds.length === 0) {
      Toast.warning('请选择抄送节点与抄送人');
      return;
    }
    setCcLoading(true);
    try {
      const res = await request.post<unknown>(`/api/workflows/instances/${instanceId}/cc/add`, { nodeKey: ccNodeKey, userIds: ccUserIds });
      if (res.code === 0) {
        Toast.success(res.message || '已补加抄送');
        setCcVisible(false);
        onRefresh();
      }
    } finally {
      setCcLoading(false);
    }
  };

  return (
    <SideSheet
      title="申请详情"
      visible={visible}
      onCancel={onClose}
      width={760}
      bodyStyle={{ padding: 16 }}
      footer={
        data?.status === 'running' ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setUrgeMessage(''); setUrgeVisible(true); }}>催办</Button>
            {ccNodeOptions.length > 0 && (
              <Button onClick={() => void openCcModal()}>添加抄送人</Button>
            )}
            <Popconfirm title="确定要撤回吗？" onConfirm={() => void handleWithdraw()}>
              <Button type="danger">撤回申请</Button>
            </Popconfirm>
          </Space>
        ) : null
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <WorkflowInstanceDetailPanel instance={data} definition={definition} loading={loading} />
      )}
      <AppModal
        title="催办"
        visible={urgeVisible}
        onCancel={() => setUrgeVisible(false)}
        onOk={() => void handleUrge()}
        confirmLoading={urgeLoading}
        okText="发送催办"
      >
        <Typography.Text type="tertiary" size="small">将对当前实例所有待办人发起催办（5 分钟内已被催办过的人员会被跳过）</Typography.Text>
        <TextArea
          value={urgeMessage}
          onChange={setUrgeMessage}
          placeholder="可选留言（最多 256 个字符）"
          maxLength={256}
          rows={3}
          style={{ marginTop: 8 }}
        />
      </AppModal>
      <AppModal
        title="添加抄送人"
        visible={ccVisible}
        onCancel={() => setCcVisible(false)}
        onOk={() => void handleAddCc()}
        confirmLoading={ccLoading}
        okText="提交"
      >
        <Typography.Text type="tertiary" size="small">为运行中的流程实例的抄送节点动态补加抄送人（自动去重，不会重复抄送）。</Typography.Text>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>抄送节点</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            value={ccNodeKey}
            onChange={(v) => setCcNodeKey(v as string)}
            optionList={ccNodeOptions}
            placeholder="请选择抄送节点"
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>抄送人</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            multiple
            filter
            value={ccUserIds}
            onChange={(v) => setCcUserIds(v as number[])}
            optionList={ccUserOptions}
            placeholder="请选择抄送人"
          />
        </div>
      </AppModal>
    </SideSheet>
  );
}

export default function MyApplicationsPage() {
  usePageTracker('我的申请');
  const { user } = useAuth();
  const formApi = useRef<FormApi | null>(null);
  const dynamicFormApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowInstance> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<{ status: string }>({ status: '' });
  const searchParamsRef = useRef<{ status: string }>({ status: '' });
  searchParamsRef.current = searchParams;
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applyCategoryId, setApplyCategoryId] = useState<number | null>(null);
  const { categories } = useWorkflowCategories();

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: { status: string }) => {
    const { status: activeStatus } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeStatus ? { status: activeStatus } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances?${query}`);
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
  }, [fetchList]);

  const loadDefinitions = async () => {
    const res = await request.get<WorkflowDefinition[]>('/api/workflows/definitions/published');
    if (res.code === 0 && res.data) setDefinitions(res.data);
  };

  const handleSearch = () => {
    setPage(1);
    void fetchList(1);
  };

  const handleReset = () => {
    setSearchParams({ status: '' });
    setPage(1);
    void fetchList(1, pageSize, { status: '' });
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailVisible(true);
  };

  const openApply = async () => {
    await loadDefinitions();
    setApplyVisible(true);
  };

  const handleSubmitApply = async () => {
    if (!formApi.current) return;
    try {
      const values = await formApi.current.validate() as Record<string, unknown>;
      let formData: Record<string, unknown> = {};
      if (dynamicFormApi.current && selectedDef?.formFields && selectedDef.formFields.length > 0) {
        const dyn = await dynamicFormApi.current.validate();
        formData = dyn;
      }
      setSubmitting(true);
      const res = await request.post('/api/workflows/instances', {
        definitionId: values.definitionId,
        title: values.title,
        formData,
      });
      if (res.code === 0) {
        Toast.success('申请已提交');
        setApplyVisible(false);
        setSelectedDef(null);
        void fetchList();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 200,
      render: renderEllipsis,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: renderEllipsis,
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
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
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openDetail(record.id)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
          <Select
            placeholder="全部状态"
            value={searchParams.status || undefined}
            onChange={v => setSearchParams({ status: typeof v === 'string' ? v : '' })}
            showClear
            style={{ width: 140 }}
          >
            {Object.entries(INSTANCE_STATUS_MAP).map(([k, s]) => (
              <Select.Option key={k} value={k}>{s.text}</Select.Option>
            ))}
          </Select>
          <Button type="primary" icon={<Search size={14} />} onClick={() => { trackFeature('search-btn', '查询', 'search-toolbar'); handleSearch(); }}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { trackFeature('reset-btn', '重置', 'search-toolbar'); handleReset(); }}>重置</Button>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => { trackFeature('create-btn', '发起申请', 'search-toolbar'); void openApply(); }}>
            发起申请
          </Button>
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
      />

      {/* 申请详情 */}
      <InstanceDetailDrawer
        instanceId={selectedId}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        onRefresh={() => void fetchList()}
      />

      {/* 发起申请抽屉 */}
      <SideSheet
        title="发起申请"
        visible={applyVisible}
        onCancel={() => { setApplyVisible(false); setSelectedDef(null); }}
        width={720}
        bodyStyle={{ padding: 16 }}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setApplyVisible(false); setSelectedDef(null); }}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void handleSubmitApply()}>提交</Button>
          </Space>
        )}
      >
        <Form getFormApi={api => { formApi.current = api; }}>
          <Form.Select
            field="categoryId"
            label="流程分类"
            placeholder="全部分类"
            showClear
            style={{ width: '100%' }}
            initValue={applyCategoryId ?? undefined}
            onChange={v => {
              const next = typeof v === 'number' ? v : null;
              setApplyCategoryId(next);
              setSelectedDef(null);
              formApi.current?.setValue('definitionId', undefined);
              formApi.current?.setValue('title', '');
            }}
            optionList={categories.map(c => ({ value: c.id, label: c.name }))}
          />
          <Form.Select
            field="definitionId"
            label="选择流程"
            placeholder="请选择要发起的流程"
            rules={[{ required: true, message: '请选择流程' }]}
            style={{ width: '100%' }}
            optionList={definitions
              .filter(d => applyCategoryId === null || d.categoryId === applyCategoryId)
              .map(d => ({ value: d.id, label: d.name }))}
            onChange={v => {
              const def = definitions.find(d => d.id === v) ?? null;
              setSelectedDef(def);
              if (def) {
                const who = user?.nickname || user?.username || '我';
                const auto = `${def.name} - ${who} - ${dayjs().format('YYYY-MM-DD')}`;
                formApi.current?.setValue('title', auto);
              }
            }}
          />
          <Form.Input
            field="title"
            label="申请标题"
            placeholder="选择流程后自动生成，可手动修改"
            rules={[{ required: true, message: '请填写申请标题' }]}
          />
          {selectedDef?.description && (
            <div style={{ padding: '8px 0', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
              <FileInput size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {selectedDef.description}
            </div>
          )}
        </Form>
        {selectedDef && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
            <Tabs type="line" defaultActiveKey="form">
              <TabPane tab="填写表单" itemKey="form">
                {selectedDef.formFields && selectedDef.formFields.length > 0 ? (
                  <WorkflowFormRenderer
                    fields={selectedDef.formFields}
                    getFormApi={api => { dynamicFormApi.current = api; }}
                  />
                ) : (
                  <Typography.Text type="tertiary">该流程未配置表单字段</Typography.Text>
                )}
              </TabPane>
              <TabPane tab="流程图预览" itemKey="graph">
                <WorkflowGraphView flowData={selectedDef.flowData} />
              </TabPane>
              <TabPane tab="节点详情" itemKey="nodes">
                <WorkflowNodeListView flowData={selectedDef.flowData} />
              </TabPane>
            </Tabs>
          </div>
        )}
      </SideSheet>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import { Search, Plus, RotateCcw, Download, Play } from 'lucide-react';
import type { CronJob, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import { usePermission } from '../../../hooks/usePermission';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function CronJobsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CronJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);

  const fetchData = useCallback(async (p = page, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<CronJob>>(`/api/cron-jobs?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    void fetchData();
    request.get<string[]>('/api/cron-jobs/handlers').then((res) => {
      if (res.code === 0) setHandlers(res.data);
    });
  }, []);

  const handleSearch = () => { setPage(1); void fetchData(1); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, defaultSearchParams); };
  const handlePageChange = (p: number) => { setPage(p); void fetchData(p); };

  const handleExport = async () => {
    try {
      await request.download('/api/cron-jobs/export', '定时任务.xlsx');
      Toast.success('导出成功');
    } catch { Toast.error('导出失败'); }
  };

  const handleRunOnce = (id: number, name: string) => {
    Modal.confirm({
      title: '确定要立即执行一次吗？',
      content: `任务：${name}`,
      onOk: async () => {
        const res = await request.post(`/api/cron-jobs/${id}/run`);
        if (res.code === 0) {
          Toast.success('已触发执行');
          void fetchData();
        } else {
          Toast.error(res.message);
        }
      },
    });
  };

  const handleModalOk = async () => {
    let values: any;
    try { values = await formApi.current?.validate(); } catch { throw new Error('validation'); }

    const res = editingJob
      ? await request.put(`/api/cron-jobs/${editingJob.id}`, values)
      : await request.post('/api/cron-jobs', values);

    if (res.code === 0) {
      Toast.success(editingJob ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingJob(null);
      void fetchData();
    } else {
      Toast.error(res.message);
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/cron-jobs/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    } else {
      Toast.error(res.message);
    }
  };

  const formInitValues = editingJob
    ? {
        name: editingJob.name,
        cronExpression: editingJob.cronExpression,
        handler: editingJob.handler,
        params: editingJob.params,
        status: editingJob.status,
        description: editingJob.description,
      }
    : { status: 'active' };

  const runStatusColor: Record<string, import('@douyinfe/semi-ui/lib/es/tag/interface').TagColor> = {
    success: 'green',
    fail: 'red',
    running: 'blue',
  };

  const columns: ColumnProps<CronJob>[] = [
    { title: '任务名称', dataIndex: 'name', width: 180, ellipsis: true },
    { title: 'Cron 表达式', dataIndex: 'cronExpression', width: 150 },
    { title: '处理器', dataIndex: 'handler', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'grey'} size="small">{v === 'active' ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '上次执行', dataIndex: 'lastRunStatus', width: 90,
      render: (v: string | null) =>
        v ? <Tag color={runStatusColor[v] ?? 'grey'} size="small">{v}</Tag> : '—',
    },
    {
      title: '上次执行时间', dataIndex: 'lastRunAt', width: 180,
      render: (v: string | null) => v ? formatDateTime(v) : '—',
    },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '操作',
      fixed: 'right',
      width: 200,
      render: (_: unknown, record: CronJob) => (
        <Space>
          {hasPermission('system:cron:execute') && (
            <Button theme="borderless" size="small" onClick={() => handleRunOnce(record.id, record.name)}>
              执行
            </Button>
          )}
          {hasPermission('system:cron:update') && (
            <Button theme="borderless" size="small" onClick={() => { setEditingJob(record); setModalVisible(true); }}>
              编辑
            </Button>
          )}
          {hasPermission('system:cron:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => {
              Modal.confirm({ title: '确定要删除此任务吗？', onOk: () => handleDelete(record.id) });
            }}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索任务名称/处理器"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
              onEnterPress={handleSearch}
              style={{ width: 240 }}
              showClear
            />
            <Select
              placeholder="状态"
              value={searchParams.status || undefined}
              onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
              style={{ width: 140 }}
              optionList={[
                { value: '', label: '全部' },
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '禁用' },
              ]}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </Space>
          <Space>
            <Button icon={<Download size={14} />} onClick={handleExport}>导出</Button>
            {hasPermission('system:cron:create') && (
              <Button type="secondary" icon={<Plus size={14} />} onClick={() => { setEditingJob(null); setModalVisible(true); }}>新增</Button>
            )}
          </Space>
        </div>
      </div>

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: handlePageChange,
        }}
        empty="暂无数据"
      />

      <Modal
        title={editingJob ? '编辑定时任务' : '新增定时任务'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingJob(null); }}
        onOk={handleModalOk}
        width={560}
      >
        <Form
          key={editingJob?.id ?? 'new-job'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={100}
        >
          <Form.Input field="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]} />
          <Form.Input field="cronExpression" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]} placeholder="如 */5 * * * *" />
          <Form.Select
            field="handler"
            label="处理器"
            rules={[{ required: true, message: '请选择处理器' }]}
            optionList={handlers.map((h) => ({ value: h, label: h }))}
            style={{ width: '100%' }}
            filter
          />
          <Form.TextArea field="params" label="参数(JSON)" placeholder='可选，如 {"key":"value"}' />
          <Form.Select
            field="status"
            label="状态"
            optionList={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '禁用' },
            ]}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="description" label="描述" maxCount={256} />
        </Form>
      </Modal>
    </div>
  );
}

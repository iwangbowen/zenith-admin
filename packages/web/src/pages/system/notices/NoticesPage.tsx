import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Tag,
  Space,
  Modal,
  Form,
  Toast,
  Popconfirm,
  Select,
} from '@douyinfe/semi-ui';
import { Search, Plus, RotateCcw, Pencil, Trash2 } from 'lucide-react';
import type { Notice, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import { useDictItems } from '../../../hooks/useDictItems';
import DictTag from '../../../components/DictTag';

type SearchParams = {
  title: string;
  type: string;
  publishStatus: string;
};

export default function NoticesPage() {
  const [data, setData] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>({ title: '', type: '', publishStatus: '' });
  const [submittedParams, setSubmittedParams] = useState<SearchParams>({ title: '', type: '', publishStatus: '' });

  const [modalVisible, setModalVisible] = useState(false);
  const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formApi, setFormApi] = useState<any>(null);

  const { items: typeItems } = useDictItems('notice_type');
  const { items: statusItems } = useDictItems('notice_publish_status');
  const { items: priorityItems } = useDictItems('notice_priority');

  const fetchData = useCallback(async (p = page, ps = pageSize, params = submittedParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.title ? { title: params.title } : {}),
        ...(params.type ? { type: params.type } : {}),
        ...(params.publishStatus ? { publishStatus: params.publishStatus } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<Notice>>(`/api/notices?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, submittedParams]);

  useEffect(() => {
    fetchData();
  }, []);

  const handleSearch = () => {
    setSubmittedParams({ ...searchParams });
    setPage(1);
    fetchData(1, pageSize, searchParams);
  };

  const handleReset = () => {
    const empty: SearchParams = { title: '', type: '', publishStatus: '' };
    setSearchParams(empty);
    setSubmittedParams(empty);
    setPage(1);
    fetchData(1, pageSize, empty);
  };

  const openCreateModal = () => {
    setEditingNotice(null);
    setModalVisible(true);
  };

  const openEditModal = (record: Notice) => {
    setEditingNotice(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete<null>(`/api/notices/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchData(page, pageSize, submittedParams);
    } else {
      Toast.error(res.message || '删除失败');
    }
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    let values: Record<string, unknown>;
    try {
      values = await formApi.validate();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: values.title,
        content: values.content,
        type: values.type || 'notice',
        publishStatus: values.publishStatus || 'draft',
        priority: values.priority || 'medium',
      };
      let res;
      if (editingNotice) {
        res = await request.put<Notice>(`/api/notices/${editingNotice.id}`, payload);
      } else {
        res = await request.post<Notice>('/api/notices', payload);
      }
      if (res.code === 0) {
        Toast.success(editingNotice ? '更新成功' : '创建成功');
        setModalVisible(false);
        fetchData(editingNotice ? page : 1, pageSize, submittedParams);
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const publishStatusColorMap: Record<string, string> = {
    draft: 'grey',
    published: 'green',
    recalled: 'orange',
  };

  const columns: ColumnProps<Notice>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '标题', dataIndex: 'title', width: 220, ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: string) => <DictTag dictCode="notice_type" value={v} />,
    },
    {
      title: '发布状态',
      dataIndex: 'publishStatus',
      width: 110,
      render: (v: string) => {
        const item = statusItems.find((i) => i.value === v);
        return <Tag         color={publishStatusColorMap[v] as 'grey' | 'green' | 'orange'}>{item?.label ?? v}</Tag>;
      },
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 100,
      render: (v: string) => <DictTag dictCode="notice_priority" value={v} />,
    },
    { title: '创建人', dataIndex: 'createByName', width: 110 },
    {
      title: '发布时间',
      dataIndex: 'publishTime',
      width: 170,
      render: (v: string | null) => (v ? formatDateTime(v) : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      dataIndex: 'op',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, record: Notice) => (
        <Space>
          <Button
            icon={<Pencil size={14} strokeWidth={1.8} />}
            size="small"
            theme="borderless"
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除这条通知吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button
              icon={<Trash2 size={14} strokeWidth={1.8} />}
              size="small"
              theme="borderless"
              type="danger"
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索标题"
              value={searchParams.title}
              onChange={(v) => setSearchParams((prev) => ({ ...prev, title: v }))}
              onEnterPress={handleSearch}
              style={{ width: 200 }}
              showClear
            />
            <Select
              placeholder="通知类型"
              value={searchParams.type || undefined}
              onChange={(v) => setSearchParams((prev) => ({ ...prev, type: String(v ?? '') }))}
              optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 140 }}
            />
            <Select
              placeholder="发布状态"
              value={searchParams.publishStatus || undefined}
              onChange={(v) => setSearchParams((prev) => ({ ...prev, publishStatus: String(v ?? '') }))}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              showClear
              style={{ width: 140 }}
            />
            <Button icon={<Search size={14} />} type="primary" onClick={handleSearch}>查询</Button>
            <Button icon={<RotateCcw size={14} />} type="tertiary" onClick={handleReset}>重置</Button>
          </Space>
          <Space>
            <Button icon={<Plus size={14} />} type="secondary" onClick={openCreateModal}>新增</Button>
          </Space>
        </div>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={{
            total,
            currentPage: page,
            pageSize,
            showSizeChanger: true,
            pageSizeOpts: [10, 20, 50],
            onPageChange: (p: number) => {
              setPage(p);
              fetchData(p, pageSize, submittedParams);
            },
            onPageSizeChange: (ps: number) => {
              setPageSize(ps);
              setPage(1);
              fetchData(1, ps, submittedParams);
            },
          }}
        />
      </Card>

      <Modal
        title={editingNotice ? '编辑通知' : '新增通知'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        okText={editingNotice ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={submitting}
        width={640}
        afterClose={() => formApi?.reset()}
      >
        <Form
          getFormApi={(api) => setFormApi(api)}
          layout="vertical"
          initValues={
            editingNotice
              ? {
                  title: editingNotice.title,
                  content: editingNotice.content,
                  type: editingNotice.type,
                  publishStatus: editingNotice.publishStatus,
                  priority: editingNotice.priority,
                }
              : { type: 'notice', publishStatus: 'draft', priority: 'medium' }
          }
        >
          <Form.Input
            field="title"
            label="标题"
            placeholder="请输入通知标题"
            rules={[{ required: true, message: '标题不能为空' }]}
          />
          <Form.TextArea
            field="content"
            label="内容"
            placeholder="请输入通知内容"
            rows={5}
            rules={[{ required: true, message: '内容不能为空' }]}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Form.Select
              field="type"
              label="通知类型"
              optionList={typeItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择类型"
              style={{ width: '100%' }}
            />
            <Form.Select
              field="publishStatus"
              label="发布状态"
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择状态"
              style={{ width: '100%' }}
            />
            <Form.Select
              field="priority"
              label="优先级"
              optionList={priorityItems.map((i) => ({ label: i.label, value: i.value }))}
              placeholder="请选择优先级"
              style={{ width: '100%' }}
            />
          </div>
        </Form>
      </Modal>
    </div>
  );
}

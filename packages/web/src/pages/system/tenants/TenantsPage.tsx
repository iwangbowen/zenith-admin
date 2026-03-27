import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Tag,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { Tenant } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';

export default function TenantsPage() {
  const { hasPermission } = usePermission();

  interface SearchParams {
    keyword: string;
    status: string;
  }

  const defaultSearchParams: SearchParams = { keyword: '', status: '' };
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const fetchData = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
      }).toString();
      const res = await request.get<{ list: Tenant[]; total: number }>(`/api/tenants?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function handleSearch() {
    setPage(1);
    void fetchData(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  }

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const payload = {
      ...values,
      expireAt: values.expireAt ? new Date(values.expireAt).toISOString() : null,
    };
    const res = editingTenant
      ? await request.put(`/api/tenants/${editingTenant.id}`, payload)
      : await request.post('/api/tenants', payload);
    if (res.code === 0) {
      Toast.success(editingTenant ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchData();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/tenants/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchData();
    }
  };

  const columns: ColumnProps<Tenant>[] = [
    { title: '租户名称', dataIndex: 'name', width: 160, ellipsis: true },
    { title: '租户编码', dataIndex: 'code', width: 140, ellipsis: true },
    { title: '联系人', dataIndex: 'contactName', width: 120, ellipsis: true, render: (v) => v || '—' },
    { title: '联系电话', dataIndex: 'contactPhone', width: 140, ellipsis: true, render: (v) => v || '—' },
    { title: '最大用户数', dataIndex: 'maxUsers', width: 120, align: 'center', render: (v) => v ?? '不限' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'red'} type="light">
          {v === 'active' ? '正常' : '停用'}
        </Tag>
      ),
    },
    {
      title: '到期时间',
      dataIndex: 'expireAt',
      width: 180,
      ellipsis: true,
      render: (v) => v ? formatDateTime(v) : '永不过期',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      ellipsis: true,
      render: (v) => formatDateTime(v),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 160,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:tenant:update') && (
            <Button
              theme="borderless"
              size="small"
              onClick={() => { setEditingTenant(row); setModalVisible(true); }}
            >
              编辑
            </Button>
          )}
          {hasPermission('system:tenant:delete') && (
            <Button
              theme="borderless"
              size="small"
              type="danger"
              onClick={() => {
                Modal.confirm({
                  title: '确认删除此租户？',
                  content: '删除后该租户下的所有数据将不可访问',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  onOk: () => handleDelete(row.id),
                });
              }}
            >
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
        <div className="responsive-toolbar">
          <div className="responsive-toolbar__left">
            <Space wrap>
              <Input
                prefix={<Search size={14} />}
                placeholder="搜索租户名称/编码"
                value={searchParams.keyword}
                onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
                onEnterPress={handleSearch}
                style={{ width: 220 }}
                showClear
              />
              <Select
                placeholder="请选择状态"
                value={searchParams.status || undefined}
                onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
                style={{ width: 140 }}
                optionList={[
                  { value: '', label: '全部状态' },
                  { value: 'active', label: '正常' },
                  { value: 'disabled', label: '停用' },
                ]}
              />
              <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
              <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            </Space>
          </div>
          <div className="responsive-toolbar__right">
            <Space>
              <Button
                icon={<Download size={14} />}
                loading={exportLoading}
                onClick={async () => {
                  setExportLoading(true);
                  try { await request.download('/api/tenants/export', '租户列表.xlsx'); }
                  finally { setExportLoading(false); }
                }}
              >
                导出
              </Button>
              {hasPermission('system:tenant:create') && (
                <Button
                  type="secondary"
                  icon={<Plus size={14} />}
                  onClick={() => { setEditingTenant(null); setModalVisible(true); }}
                >
                  新增
                </Button>
              )}
            </Space>
          </div>
        </div>
      </div>

      <div>
        <Table
          bordered
          className="admin-table-nowrap"
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{
            currentPage: page,
            pageSize,
            total,
            showSizeChanger: true,
            onPageChange: (p) => { setPage(p); void fetchData(p, pageSize); },
            onPageSizeChange: (ps) => { setPageSize(ps); setPage(1); void fetchData(1, ps); },
          }}
        />
      </div>

      <Modal
        title={editingTenant ? '编辑租户' : '新增租户'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleModalOk}
        width={520}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => (formApi.current = api)}
          initValues={editingTenant ?? { status: 'active' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="租户名称" rules={[{ required: true, message: '请输入租户名称' }]} />
          <Form.Input field="code" label="租户编码" rules={[{ required: true, message: '请输入租户编码' }]} disabled={!!editingTenant} />
          <Form.Input field="contactName" label="联系人" />
          <Form.Input field="contactPhone" label="联系电话" />
          <Form.InputNumber field="maxUsers" label="最大用户数" min={1} placeholder="不填则不限" />
          <Form.Select
            field="status"
            label="状态"
            optionList={[
              { value: 'active', label: '正常' },
              { value: 'disabled', label: '停用' },
            ]}
          />
          <Form.DatePicker field="expireAt" label="到期时间" type="dateTime" placeholder="不填则永不过期" />
          <Form.TextArea field="remark" label="备注" rows={3} />
        </Form>
      </Modal>
    </div>
  );
}

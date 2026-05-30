import { useState, useEffect, useCallback, useRef, useTransition} from 'react';
import {
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Tag,
  Row,
  Col,
  Spin,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { Tenant } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

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
  const [isPending, startTransition] = useTransition();
  const [exportLoading, setExportLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  const fetchData = useCallback((p = page, ps = pageSize, params = searchParams) => {
    startTransition(async () => {
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
    });
  }, [page, pageSize, searchParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSearch() {
    setPage(1);
    fetchData(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    fetchData(1, pageSize, defaultSearchParams);
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
      expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null,
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
    { title: '租户名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '租户编码', dataIndex: 'code', width: 140, render: renderEllipsis },
    { title: '联系人', dataIndex: 'contactName', width: 120, render: renderEllipsis },
    { title: '联系电话', dataIndex: 'contactPhone', width: 140, render: renderEllipsis },
    { title: '最大用户数', dataIndex: 'maxUsers', width: 120, align: 'center', render: (v) => v ?? '不限' },
    {
      title: '到期时间',
      dataIndex: 'expireAt',
      width: 180,
      render: (v) => renderEllipsis(v ? formatDateTime(v) : '永不过期'),
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string) => (
        <Tag color={v === 'enabled' ? 'green' : 'red'} type="light">
          {v === 'enabled' ? '正常' : '停用'}
        </Tag>
      ),
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
              onClick={async () => {
                setEditingTenant(row);
                setModalVisible(true);
                setModalDetailLoading(true);
                const res = await request.get<Tenant>(`/api/tenants/${row.id}`);
                setModalDetailLoading(false);
                if (res.code === 0 && res.data) {
                  setEditingTenant(res.data);
                } else {
                  Toast.error(res.message || '获取租户信息失败');
                }
              }}
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
      <SearchToolbar>
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
              { value: 'enabled', label: '正常' },
              { value: 'disabled', label: '停用' },
            ]}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
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
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => { setEditingTenant(null); setModalVisible(true); }}
            >
              新增
            </Button>
          )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        rowKey="id"
        pending={isPending}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          showSizeChanger: true,
          onPageChange: (p) => { setPage(p); fetchData(p, pageSize); },
          onPageSizeChange: (ps) => { setPageSize(ps); setPage(1); fetchData(1, ps); },
        }}
      />

      <Modal
        title={editingTenant ? '编辑租户' : '新增租户'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingTenant(null); setModalDetailLoading(false); }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={660}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          getFormApi={(api) => (formApi.current = api)}
          allowEmpty
          initValues={editingTenant ?? { status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="租户名称" placeholder="请输入租户名称" rules={[{ required: true, message: '请输入租户名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="租户编码" placeholder="请输入租户编码" rules={[{ required: true, message: '请输入租户编码' }]} disabled={!!editingTenant} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="contactName" label="联系人" placeholder="请输入联系人" />
            </Col>
            <Col span={12}>
              <Form.Input field="contactPhone" label="联系电话" placeholder="请输入联系电话" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="maxUsers" label="最大用户数" min={1} placeholder="不填则不限" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.Select
                field="status"
                label="状态"
                style={{ width: '100%' }}
                optionList={[
                  { value: 'enabled', label: '正常' },
                  { value: 'disabled', label: '停用' },
                ]}
                placeholder="请选择状态"
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.DatePicker field="expireAt" label="到期时间" type="dateTime" placeholder="不填则永不过期" style={{ width: '100%' }} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="remark" label="备注" placeholder="请输入备注" rows={3} />
            </Col>
          </Row>
        </Form>
        </Spin>
      </Modal>
    </div>
  );
}

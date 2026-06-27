import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Tag, Modal, Form, Toast, Typography, Select, Row, Col } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { RatePlan, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { createdAtColumn } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

const { Text } = Typography;

const STATUS_OPTIONS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '禁用' },
];

const fmtQuota = (n: number) => (n > 0 ? n.toLocaleString() : '不限');

type FormValues = {
  code: string;
  name: string;
  description?: string;
  qpsLimit: number;
  dailyQuota: number;
  monthlyQuota: number;
  isDefault: boolean;
  status: 'enabled' | 'disabled';
};

export default function RatePlansPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('open:rate-plan:manage');
  const formApi = useRef<FormApi | null>(null);

  interface SearchParams { keyword: string; status?: 'enabled' | 'disabled' }
  const defaultSearchParams: SearchParams = { keyword: '', status: undefined };
  const [data, setData] = useState<PaginatedResponse<RatePlan> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchRef = useRef<SearchParams>(defaultSearchParams);
  searchRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<RatePlan | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const sp = params ?? searchRef.current;
      setLoading(true);
      try {
        const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (sp.keyword) q.keyword = sp.keyword;
        if (sp.status) q.status = sp.status;
        const res = await request.get<PaginatedResponse<RatePlan>>(`/api/rate-plans?${new URLSearchParams(q)}`);
        if (res.code === 0) {
          setData(res.data);
          setPage(res.data.page);
        }
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, setPage],
  );

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    setPage(1);
    void fetchData(1, pageSize);
  }
  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  }

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }
  function openEdit(record: RatePlan) {
    setEditing(record);
    setModalVisible(true);
    formApi.current?.setValues({
      code: record.code,
      name: record.name,
      description: record.description ?? '',
      qpsLimit: record.qpsLimit,
      dailyQuota: record.dailyQuota,
      monthlyQuota: record.monthlyQuota,
      isDefault: record.isDefault,
      status: record.status,
    });
  }
  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const formInitValues: Partial<FormValues> = editing
    ? {
        code: editing.code,
        name: editing.name,
        description: editing.description ?? '',
        qpsLimit: editing.qpsLimit,
        dailyQuota: editing.dailyQuota,
        monthlyQuota: editing.monthlyQuota,
        isDefault: editing.isDefault,
        status: editing.status,
      }
    : { qpsLimit: 10, dailyQuota: 0, monthlyQuota: 0, isDefault: false, status: 'enabled' };

  async function handleModalOk() {
    let values: FormValues;
    try {
      values = (await formApi.current?.validate()) as FormValues;
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');
    setSubmitting(true);
    try {
      const res = editing
        ? await request.put(`/api/rate-plans/${editing.id}`, values)
        : await request.post('/api/rate-plans', values);
      if (res.code === 0) {
        Toast.success(editing ? '更新成功' : '创建成功');
        closeModal();
        void fetchData();
      } else {
        throw new Error(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/rate-plans/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    }
  }

  const columns: ColumnProps<RatePlan>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '套餐',
      dataIndex: 'name',
      width: 200,
      render: (v: string, r: RatePlan) => (
        <span>
          {v}{' '}
          {r.isDefault && <Tag color="blue" size="small">默认</Tag>}
          <div><Text type="tertiary" size="small" copyable={{ content: r.code }}>{r.code}</Text></div>
        </span>
      ),
    },
    { title: 'QPS', dataIndex: 'qpsLimit', width: 100, render: (v: number) => (v > 0 ? `${v}/s` : '不限') },
    { title: '每日配额', dataIndex: 'dailyQuota', width: 120, render: fmtQuota },
    { title: '每月配额', dataIndex: 'monthlyQuota', width: 120, render: fmtQuota },
    { title: '描述', dataIndex: 'description', width: 220, render: (v: string | null) => v || <Text type="tertiary">—</Text> },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '禁用'}</Tag>,
    },
    createOperationColumn<RatePlan>({
      width: 140,
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !canManage, onClick: () => openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除此套餐吗？',
              content: '已被应用绑定的套餐无法删除',
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
              placeholder="搜索套餐编码 / 名称"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams({ ...searchParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 220 }}
            />
            <Select
              placeholder="状态"
              value={searchParams.status}
              onChange={(v) => setSearchParams({ ...searchParams, status: v as 'enabled' | 'disabled' })}
              optionList={STATUS_OPTIONS}
              showClear
              style={{ width: 110 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索套餐"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams({ ...searchParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobileActions={<Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>}
        actionTitle="套餐操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="id"
        size="small"
        empty="暂无数据"
        pagination={buildPagination(data?.total ?? 0, fetchData)}
      />

      <AppModal
        title={editing ? '编辑限流套餐' : '新增限流套餐'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
        width={660}
        closeOnEsc
      >
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="code"
                label="套餐编码"
                placeholder="如 free / pro"
                disabled={!!editing}
                extraText={editing ? '编码不可修改' : '小写字母开头'}
                rules={[{ required: true, message: '套餐编码不能为空' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Input field="name" label="套餐名称" placeholder="如 免费版" rules={[{ required: true, message: '名称不能为空' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.InputNumber field="qpsLimit" label="QPS" min={0} style={{ width: '100%' }} extraText="0=不限" rules={[{ required: true, message: '必填' }]} />
            </Col>
            <Col span={8}>
              <Form.InputNumber field="dailyQuota" label="每日配额" min={0} style={{ width: '100%' }} extraText="0=不限" rules={[{ required: true, message: '必填' }]} />
            </Col>
            <Col span={8}>
              <Form.InputNumber field="monthlyQuota" label="每月配额" min={0} style={{ width: '100%' }} extraText="0=不限" rules={[{ required: true, message: '必填' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Switch field="isDefault" label="默认套餐" extraText="应用未绑定套餐时回退使用" />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={STATUS_OPTIONS} rules={[{ required: true, message: '请选择状态' }]} />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" placeholder="套餐说明（可选）" rows={2} />
        </Form>
      </AppModal>
    </div>
  );
}

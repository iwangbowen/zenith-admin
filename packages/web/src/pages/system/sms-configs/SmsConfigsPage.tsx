import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, SmsConfig, SmsProvider } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import DictTag from '@/components/DictTag';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

const PROVIDER_OPTIONS = [
  { label: '阿里云', value: 'aliyun' },
  { label: '腾讯云', value: 'tencent' },
];

export default function SmsConfigsPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<SmsConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [filterProvider, setFilterProvider] = useState<SmsProvider | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SmsConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(
    async (p: number, kw: string, pr: SmsProvider | undefined, st: string | undefined, ps = 10) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) params.set('keyword', kw);
        if (pr) params.set('provider', pr);
        if (st) params.set('status', st);
        const res = await request.get<PaginatedResponse<SmsConfig>>(`/api/sms-configs?${params}`);
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
        setPage(res.data?.page ?? p);
        setPageSize(res.data?.pageSize ?? ps);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => { void fetchList(1, '', undefined, undefined, 10); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleSearch = () => { void fetchList(1, keyword, filterProvider, filterStatus, pageSize); };
  const handleReset = () => {
    setKeyword(''); setFilterProvider(undefined); setFilterStatus(undefined);
    void fetchList(1, '', undefined, undefined, pageSize);
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: SmsConfig) => { setEditingRecord(record); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    setSubmitting(true);
    try {
      if (editingRecord) {
        const payload: Record<string, unknown> = { ...values };
        if (!payload.accessKeySecret) delete payload.accessKeySecret;
        await request.put(`/api/sms-configs/${editingRecord.id}`, payload);
        Toast.success('更新成功');
      } else {
        await request.post('/api/sms-configs', values);
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList(page, keyword, filterProvider, filterStatus, pageSize);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (record: SmsConfig) => {
    await request.post(`/api/sms-configs/${record.id}/default`);
    Toast.success('已设为默认');
    void fetchList(page, keyword, filterProvider, filterStatus, pageSize);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该短信配置吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete(`/api/sms-configs/${id}`);
        Toast.success('删除成功');
        void fetchList(page, keyword, filterProvider, filterStatus, pageSize);
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: 'AccessKeyId', dataIndex: 'accessKeyId', width: 180, ellipsis: true },
    { title: '签名', dataIndex: 'signName', width: 120 },
    { title: '地域', dataIndex: 'region', width: 140, render: (v: string | null) => v || '—' },
    {
      title: '默认', dataIndex: 'isDefault', width: 80,
      render: (v: boolean) => (v ? <Tag color="blue" type="light">默认</Tag> : '—'),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    {
      title: '操作', key: 'actions', width: 200, fixed: 'right' as const,
      render: (_: unknown, record: SmsConfig) => (
        <Space>
          {can('system:sms-config:update') && !record.isDefault && (
            <Button theme="borderless" size="small" onClick={() => handleSetDefault(record)}>设为默认</Button>
          )}
          {can('system:sms-config:update') && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>
          )}
          {can('system:sms-config:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record.id)}>删除</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索名称/签名"
          value={keyword} onChange={setKeyword} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
        <Select placeholder="服务商" value={filterProvider} onChange={(v) => setFilterProvider(v as SmsProvider | undefined)}
          optionList={PROVIDER_OPTIONS} showClear style={{ width: 120 }} />
        <Select placeholder="状态" value={filterStatus} onChange={(v) => setFilterStatus(v as string | undefined)}
          optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('system:sms-config:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable bordered loading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={{
          total, currentPage: page, pageSize, showTotal: true, showSizeChanger: true,
          onPageChange: (p: number) => { void fetchList(p, keyword, filterProvider, filterStatus, pageSize); },
          onPageSizeChange: (s: number) => { void fetchList(1, keyword, filterProvider, filterStatus, s); },
        }}
        scroll={{ x: 1300 }} />

      <Modal title={editingRecord ? '编辑短信配置' : '新增短信配置'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={560}>
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          labelPosition="left" labelWidth={110}
          initValues={editingRecord
            ? { ...editingRecord, accessKeySecret: '' }
            : { status: 'enabled', isDefault: false, provider: 'aliyun' }}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Select field="provider" label="服务商" style={{ width: '100%' }} optionList={PROVIDER_OPTIONS}
            rules={[{ required: true, message: '请选择服务商' }]} />
          <Form.Input field="accessKeyId" label="AccessKeyId" rules={[{ required: true, message: '请输入 AccessKeyId' }]} />
          <Form.Input field="accessKeySecret" label="AccessKeySecret" mode="password"
            placeholder={editingRecord ? '不修改请留空' : '请输入 AccessKeySecret'}
            rules={editingRecord ? [] : [{ required: true, message: '请输入 AccessKeySecret' }]} />
          <Form.Input field="signName" label="短信签名" rules={[{ required: true, message: '请输入短信签名' }]} />
          <Form.Input field="region" label="地域" placeholder="如：cn-hangzhou" />
          <Form.Switch field="isDefault" label="设为默认" />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.TextArea field="remark" label="备注" rows={2} />
        </Form>
      </Modal>
    </div>
  );
}

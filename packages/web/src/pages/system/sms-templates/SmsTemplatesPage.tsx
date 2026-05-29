import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Col, Form, Input, Modal, Row, Select, Space, Spin, Typography,
  Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, SmsTemplate, SmsProvider } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import DictTag from '@/components/DictTag';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

const PROVIDER_OPTIONS = [
  { label: '阿里云', value: 'aliyun' },
  { label: '腾讯云', value: 'tencent' },
];

export default function SmsTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<SmsTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [filterProvider, setFilterProvider] = useState<SmsProvider | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SmsTemplate | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
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
        const res = await request.get<PaginatedResponse<SmsTemplate>>(`/api/sms-templates?${params}`);
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
  const openEdit = async (record: SmsTemplate) => {
    setEditingRecord(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<SmsTemplate>(`/api/sms-templates/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0) {
      setEditingRecord(res.data);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    setSubmitting(true);
    try {
      if (editingRecord) {
        await request.put(`/api/sms-templates/${editingRecord.id}`, values);
        Toast.success('更新成功');
      } else {
        await request.post('/api/sms-templates', values);
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList(page, keyword, filterProvider, filterStatus, pageSize);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该短信模板吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete(`/api/sms-templates/${id}`);
        Toast.success('删除成功');
        void fetchList(page, keyword, filterProvider, filterStatus, pageSize);
      },
    });
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '服务商模板号', dataIndex: 'templateCode', width: 160 },
    { title: '签名', dataIndex: 'signName', width: 120, render: (v: string | null) => v || '—' },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    {
      title: '操作', key: 'actions', width: 130, fixed: 'right' as const,
      render: (_: unknown, record: SmsTemplate) => (
        <Space>
          {can('system:sms-template:update') && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>
          )}
          {can('system:sms-template:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record.id)}>删除</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索模板名称/编码"
          value={keyword} onChange={setKeyword} onEnterPress={handleSearch} showClear style={{ width: 220 }} />
        <Select placeholder="服务商" value={filterProvider} onChange={(v) => setFilterProvider(v as SmsProvider | undefined)}
          optionList={PROVIDER_OPTIONS} showClear style={{ width: 120 }} />
        <Select placeholder="状态" value={filterStatus} onChange={(v) => setFilterStatus(v as string | undefined)}
          optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('system:sms-template:create') && (
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

      <Modal title={editingRecord ? '编辑短信模板' : '新增短信模板'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); setModalDetailLoading(false); }}
        confirmLoading={submitting} okButtonProps={{ disabled: modalDetailLoading }} width={720}>
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          allowEmpty
          labelPosition="left" labelWidth={120}
          initValues={editingRecord ?? { status: 'enabled', provider: 'aliyun' }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="模板名称" placeholder="请输入模板名称"
                rules={[{ required: true, message: '请输入模板名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="模板编码" disabled={!!editingRecord} placeholder="如：order_paid"
                rules={[{ required: true, message: '请输入模板编码' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="templateCode" label="服务商模板号" placeholder="请输入服务商模板号"
                rules={[{ required: true, message: '请输入服务商模板号' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="signName" label="短信签名" placeholder="可选" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="provider" label="服务商" style={{ width: '100%' }} optionList={PROVIDER_OPTIONS}
                placeholder="请选择服务商" rules={[{ required: true, message: '请选择服务商' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="模板内容" rows={4} placeholder="请输入模板内容"
                rules={[{ required: true, message: '请输入模板内容' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="variables" label="变量" placeholder='如：{"code":"验证码"}' />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="remark" label="备注" rows={2} placeholder="请输入备注" />
            </Col>
          </Row>
        </Form>
        </Spin>
      </Modal>
    </div>
  );
}

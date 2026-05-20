import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Input, Modal, Select, Space, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { EmailTemplate, PaginatedResponse } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { request } from '@/utils/request';
import DictTag from '@/components/DictTag';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

export default function EmailTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<EmailTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<EmailTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(
    async (p: number, kw: string, st: string | undefined, ps = 10) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) params.set('keyword', kw);
        if (st) params.set('status', st);
        const res = await request.get<PaginatedResponse<EmailTemplate>>(`/api/email-templates?${params}`);
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

  useEffect(() => {
    void fetchList(1, '', undefined, 10);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => { void fetchList(1, keyword, filterStatus, pageSize); };
  const handleReset = () => {
    setKeyword(''); setFilterStatus(undefined);
    void fetchList(1, '', undefined, pageSize);
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: EmailTemplate) => { setEditingRecord(record); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    setSubmitting(true);
    try {
      if (editingRecord) {
        await request.put(`/api/email-templates/${editingRecord.id}`, values);
        Toast.success('更新成功');
      } else {
        await request.post('/api/email-templates', values);
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList(page, keyword, filterStatus, pageSize);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该邮件模板吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete(`/api/email-templates/${id}`);
        Toast.success('删除成功');
        void fetchList(page, keyword, filterStatus, pageSize);
      },
    });
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '邮件主题', dataIndex: 'subject', ellipsis: true },
    { title: '变量', dataIndex: 'variables', width: 200, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: string) => <DictTag dictCode="common_status" value={v} />,
    },
    {
      title: '操作', key: 'actions', width: 130, fixed: 'right' as const,
      render: (_: unknown, record: EmailTemplate) => (
        <Space>
          {can('system:email-template:update') && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>
          )}
          {can('system:email-template:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record.id)}>删除</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索模板名称/编码/主题"
          value={keyword} onChange={setKeyword} onEnterPress={handleSearch} showClear style={{ width: 220 }} />
        <Select placeholder="状态" value={filterStatus} onChange={(v) => setFilterStatus(v as string | undefined)}
          optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('system:email-template:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable bordered loading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={{
          total, currentPage: page, pageSize, showTotal: true, showSizeChanger: true,
          onPageChange: (p: number) => { void fetchList(p, keyword, filterStatus, pageSize); },
          onPageSizeChange: (s: number) => { void fetchList(1, keyword, filterStatus, s); },
        }}
        scroll={{ x: 1200 }} />

      <Modal title={editingRecord ? '编辑邮件模板' : '新增邮件模板'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={640}>
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          labelPosition="left" labelWidth={90}
          initValues={editingRecord ?? { status: 'enabled' }}
        >
          <Form.Input field="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]} />
          <Form.Input field="code" label="模板编码" disabled={!!editingRecord}
            rules={[{ required: true, message: '请输入模板编码' }]} placeholder="如：welcome_email" />
          <Form.Input field="subject" label="邮件主题" rules={[{ required: true, message: '请输入邮件主题' }]} />
          <Form.TextArea field="content" label="邮件内容" rows={6} rules={[{ required: true, message: '请输入邮件内容' }]} />
          <Form.Input field="variables" label="变量" placeholder='如：{"username":"用户名"}' />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.TextArea field="remark" label="备注" rows={2} />
        </Form>
      </Modal>
    </div>
  );
}

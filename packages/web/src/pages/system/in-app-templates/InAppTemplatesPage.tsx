import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Col, Form, Input, Modal, Row, Select, Spin, Tag,
  Toast, Switch } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { InAppMessageType, InAppTemplate } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  inAppTemplateKeys,
  useDeleteInAppTemplate,
  useInAppTemplateDetail,
  useInAppTemplateList,
  useSaveInAppTemplate,
} from '@/hooks/queries/in-app-templates';
import { IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR as TYPE_OPTIONS } from '../in-app-message-constants';

export default function InAppTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const queryClient = useQueryClient();

  interface SearchParams { keyword: string; filterType: InAppMessageType | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterStatus: undefined };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<InAppTemplate | null>(null);
  const formRef = useRef<FormApi>(null);

  const listQuery = useInAppTemplateList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.filterType,
    status: submittedParams.filterStatus,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useInAppTemplateDetail(editingRecord?.id, modalVisible);
  const editing = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;
  const saveMutation = useSaveInAppTemplate();
  const toggleStatusMutation = useSaveInAppTemplate();
  const deleteMutation = useDeleteInAppTemplate();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: inAppTemplateKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: inAppTemplateKeys.lists });
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: InAppTemplate) => {
    setEditingRecord(record);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: values as Record<string, unknown> });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该站内信模板吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('删除成功');
      },
    });
  };

  const handleToggleStatus = async (tpl: InAppTemplate, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用模板「${tpl.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    await toggleStatusMutation.mutateAsync({ id: tpl.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: InAppMessageType) => {
        const it = TYPE_OPTIONS.find((t) => t.value === v);
        return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? v}</Tag>;
      },
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center' as const, fixed: 'right' as const,
      render: (v: string, record: InAppTemplate) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!can('system:in-app-template:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<InAppTemplate>({
      width: 130,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:in-app-template:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:in-app-template:delete'),
          onClick: () => handleDelete(record.id),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索模板名称/编码/标题"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 240 }} />
            <Select placeholder="类型" value={draftParams.filterType} onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
              optionList={TYPE_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {can('system:in-app-template:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索模板名称/编码/标题"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 240 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {can('system:in-app-template:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Select placeholder="类型" value={draftParams.filterType} onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
              optionList={TYPE_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
          </>
        )}
        filterTitle="站内信模板筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 1100 }} />

      <AppModal title={editingRecord ? '编辑站内信模板' : '新增站内信模板'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={saveMutation.isPending} okButtonProps={{ disabled: modalDetailLoading }} width={720}>
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          allowEmpty
          labelPosition="left" labelWidth={120}
          initValues={editing ?? { status: 'enabled', type: 'info' }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="模板名称" placeholder="请输入模板名称"
                rules={[{ required: true, message: '请输入模板名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="模板编码" disabled={!!editing} placeholder="请输入模板编码"
                rules={[{ required: true, message: '请输入模板编码' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS}
                placeholder="请选择类型"
                rules={[{ required: true, message: '请选择类型' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="title" label="标题" placeholder="请输入标题"
                rules={[{ required: true, message: '请输入标题' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="内容" rows={5} placeholder="请输入内容"
                rules={[{ required: true, message: '请输入内容' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="variables" label="变量" placeholder='如：{"username":"用户名"}' />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="remark" label="备注" rows={2} placeholder="请输入备注" />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}

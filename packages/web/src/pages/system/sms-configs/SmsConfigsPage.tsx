import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Col, Form, Input, Modal, Row, Select, Spin, Tag,
  Toast, Switch } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { SMS_PROVIDER_OPTIONS } from '@zenith/shared';
import type { SmsConfig, SmsProvider } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import {
  smsConfigKeys,
  useDeleteSmsConfig,
  useSaveSmsConfig,
  useSetDefaultSmsConfig,
  useSmsConfigDetail,
  useSmsConfigList,
} from '@/hooks/queries/sms-configs';

export default function SmsConfigsPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  interface SearchParams { keyword: string; filterProvider: SmsProvider | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterProvider: undefined, filterStatus: undefined };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SmsConfig | null>(null);
  const formRef = useRef<FormApi>(null);

  const listQuery = useSmsConfigList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    provider: submittedParams.filterProvider,
    status: submittedParams.filterStatus || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useSmsConfigDetail(editingRecord?.id, modalVisible);
  const editing = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;

  const saveMutation = useSaveSmsConfig();
  const toggleStatusMutation = useSaveSmsConfig();
  const setDefaultMutation = useSetDefaultSmsConfig();
  const deleteMutation = useDeleteSmsConfig();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: smsConfigKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: smsConfigKeys.lists });
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: SmsConfig) => {
    setEditingRecord(record);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current!.validate())!; } catch { throw new Error('validation'); }
    const payload = { ...values } as Partial<SmsConfig>;
    if (editingRecord && !payload.accessKeySecret) delete payload.accessKeySecret;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  };

  const handleSetDefault = async (record: SmsConfig) => {
    await setDefaultMutation.mutateAsync(record.id);
    Toast.success('已设为默认');
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该短信配置吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('删除成功');
      },
    });
  };

  const handleToggleStatus = async (cfg: SmsConfig, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      if (cfg.isDefault) {
        Toast.warning('默认配置不能禁用，请先将其他配置设为默认');
        return;
      }
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用「${cfg.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    await toggleStatusMutation.mutateAsync({ id: cfg.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => SMS_PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: 'AccessKeyId', dataIndex: 'accessKeyId', width: 180, render: renderEllipsis },
    { title: '签名', dataIndex: 'signName', width: 120 },
    { title: '地域', dataIndex: 'region', width: 140, render: (v: string | null) => v || '—' },
    {
      title: '默认', dataIndex: 'isDefault', width: 80,
      render: (v: boolean) => (v ? <Tag color="blue" type="light">默认</Tag> : '—'),
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center' as const, fixed: 'right' as const,
      render: (v: string, record: SmsConfig) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!can('system:sms-config:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<SmsConfig>({
      width: 200,
      actions: (record) => [
        {
          key: 'default',
          label: '设为默认',
          hidden: !can('system:sms-config:update') || record.isDefault,
          onClick: () => handleSetDefault(record),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:sms-config:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:sms-config:delete'),
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
            <Input prefix={<Search size={14} />} placeholder="搜索名称/签名"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Select placeholder="服务商" value={draftParams.filterProvider} onChange={(v) => setDraftParams({ ...draftParams, filterProvider: v as SmsProvider | undefined })}
              optionList={SMS_PROVIDER_OPTIONS} showClear style={{ width: 120 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {can('system:sms-config:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索名称/签名"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {can('system:sms-config:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Select placeholder="服务商" value={draftParams.filterProvider} onChange={(v) => setDraftParams({ ...draftParams, filterProvider: v as SmsProvider | undefined })}
              optionList={SMS_PROVIDER_OPTIONS} showClear style={{ width: 120 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
              optionList={statusItems.map((i) => ({ label: i.label, value: i.value }))} showClear style={{ width: 110 }} />
          </>
        )}
        filterTitle="短信配置筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 1300 }} />

      <AppModal title={editingRecord ? '编辑短信配置' : '新增短信配置'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={saveMutation.isPending} okButtonProps={{ disabled: modalDetailLoading }} width={720}>
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          allowEmpty
          labelPosition="left" labelWidth={120}
          initValues={editing
            ? { ...editing, accessKeySecret: '' }
            : { status: 'enabled', isDefault: false, provider: 'aliyun' }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="名称" placeholder="请输入名称"
                rules={[{ required: true, message: '请输入名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="provider" label="服务商" style={{ width: '100%' }} optionList={SMS_PROVIDER_OPTIONS}
                placeholder="请选择服务商" rules={[{ required: true, message: '请选择服务商' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="signName" label="短信签名" placeholder="请输入短信签名"
                rules={[{ required: true, message: '请输入短信签名' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="region" label="地域" placeholder="如：cn-hangzhou" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="accessKeyId" label="AccessKeyId" placeholder="请输入 AccessKeyId"
                rules={[{ required: true, message: '请输入 AccessKeyId' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="accessKeySecret" label="AccessKeySecret" mode="password"
                placeholder={editingRecord ? '不修改请留空' : '请输入 AccessKeySecret'}
                rules={editingRecord ? [] : [{ required: true, message: '请输入 AccessKeySecret' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
            </Col>
            <Col span={12}>
              <Form.Switch field="isDefault" label="设为默认" />
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

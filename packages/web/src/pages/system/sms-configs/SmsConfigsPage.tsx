import { Col, Form, Row, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { SMS_PROVIDER_OPTIONS } from '@zenith/shared/messaging';
import type { CreateSmsConfigInput, SmsConfig, SmsProvider } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
import {
  smsConfigKeys,
  useDeleteSmsConfig,
  useSaveSmsConfig,
  useSetDefaultSmsConfig,
  useSmsConfigDetail,
  useSmsConfigList,
} from '@/hooks/queries/sms-configs';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';

export default function SmsConfigsPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterProvider: SmsProvider | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterProvider: undefined, filterStatus: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: smsConfigKeys.lists });

  const listQuery = useSmsConfigList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    provider: submittedParams.filterProvider,
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
  });

  const saveMutation = useSaveSmsConfig();
  const configModal = useEditModal<SmsConfig, Partial<CreateSmsConfigInput>>({
    entityName: '短信配置',
    save: saveMutation,
    useDetail: useSmsConfigDetail,
    defaults: { status: 'enabled', isDefault: false, provider: 'aliyun' },
    // 详情不回传密钥原文，编辑留空表示保持原值
    toValues: (config) => ({
      name: config.name,
      provider: config.provider,
      accessKeyId: config.accessKeyId,
      accessKeySecret: '',
      region: config.region ?? undefined,
      signName: config.signName,
      isDefault: config.isDefault,
      status: config.status,
      remark: config.remark ?? undefined,
    }),
    beforeSave: (values, { isEdit }) => {
      const payload = { ...values };
      if (isEdit && !payload.accessKeySecret) delete payload.accessKeySecret;
      return payload;
    },
    labelWidth: 120,
  });
  const toggleStatusMutation = useSaveSmsConfig();
  const setDefaultMutation = useSetDefaultSmsConfig();
  const deleteMutation = useDeleteSmsConfig();
  const status = useStatusToggle<SmsConfig>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ danger: true, title: `确认禁用「${record.name}」？`, okText: '确认禁用' }),
    disabled: (record) => !can('system:sms-config:update') || record.isDefault,
    messages: { disabled: '已禁用' },
  });

  const handleSetDefault = async (record: SmsConfig) => {
    await setDefaultMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已设为默认');
  };


  const columns = [
    { title: '名称', dataIndex: 'name', minWidth: 160 },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => SMS_PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: 'AccessKeyId', dataIndex: 'accessKeyId', width: 180, render: renderEllipsis },
    { title: '签名', dataIndex: 'signName', width: 120 },
    { title: '地域', dataIndex: 'region', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    {
      title: '默认', dataIndex: 'isDefault', width: 80,
      render: (v: boolean) => (v ? <Tag color="blue" type="light">默认</Tag> : EMPTY_PLACEHOLDER),
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<SmsConfig>({
      desktopInlineKeys: ['edit', 'delete'],
      width: 180,
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
          onClick: () => configModal.openEdit(record),
        },
        deleteAction({
          hidden: !can('system:sms-config:delete'),
          title: '确定要删除该短信配置吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称/签名" {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部服务商"
              items={SMS_PROVIDER_OPTIONS}
              {...bind('filterProvider')}
              width={140}
            />
            <StatusSelect
              items={statusItems}
              {...bind('filterStatus')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:sms-config:create') && (
          <CreateButton onClick={configModal.openCreate} />
        )}
        filterTitle="短信配置筛选"
      />

      <ConfigurableTable<SmsConfig>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...configModal.modalProps} width={720}>
        <Spin spinning={configModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={configModal.formKey} {...configModal.formProps}>
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
                placeholder={configModal.isEdit ? '不修改请留空' : '请输入 AccessKeySecret'}
                rules={configModal.isEdit ? [] : [{ required: true, message: '请输入 AccessKeySecret' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusOptions} />
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

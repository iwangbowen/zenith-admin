import { FormPasswordInput } from '@/components/PasswordInput';
import { Col, Form, Row, Tag, Toast } from '@douyinfe/semi-ui';
import { SMS_PROVIDER_OPTIONS, smsConfigContract } from '@zenith/shared/messaging';
import type { CreateSmsConfigInput, SmsConfig } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
import {
  useDeleteSmsConfig,
  useSaveSmsConfig,
  useSetDefaultSmsConfig,
  useSmsConfigDetail,
  useSmsConfigList,
} from '@/hooks/queries/sms-configs';
import { CreateButton } from '@/components/toolbar-controls';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

export default function SmsConfigsPage() {
  const { hasPermission: can } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');
  const page = useListPage({
    contract: smsConfigContract,
    useList: useSmsConfigList,
  });
  const { tableProps } = page;

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

  const operationColumn = useCrudOperationColumn<SmsConfig>({
    permission: 'system:sms-config',
    edit: configModal,
    remove: deleteMutation,
    title: '确定要删除该短信配置吗？',
    extra: (record) => [
      {
        key: 'default',
        label: '设为默认',
        hidden: !can('system:sms-config:update') || record.isDefault,
        onClick: () => handleSetDefault(record),
      },
    ],
    width: 180,
    desktopInlineKeys: ['edit', 'delete'],
  });

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
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'provider', 'status']}
        create={<CreateButton permission="system:sms-config:create" onClick={configModal.openCreate} />}
        filterTitle="短信配置筛选"
      />

      <ConfigurableTable<SmsConfig>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={configModal} width={720}>
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
            <FormPasswordInput field="accessKeySecret" label="AccessKeySecret"
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
      </EditFormModal>
    </div>
  );
}

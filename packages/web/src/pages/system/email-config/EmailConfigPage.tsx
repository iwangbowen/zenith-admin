import { useRef, useState } from 'react';
import { Form, Button, Toast, Space, Spin, Typography, Divider, Input } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Save, Send, Mail } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { useEmailConfig, useSaveEmailConfig, useTestEmailConfig } from '@/hooks/queries/email-config';

const { Title, Text } = Typography;

export default function EmailConfigPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  const configQuery = useEmailConfig();
  const saveMutation = useSaveEmailConfig();
  const testMutation = useTestEmailConfig();
  const config = configQuery.data;

  const handleSave = async () => {
    if (!formApi.current) return;
    try {
      const values = await formApi.current.validate();
      await saveMutation.mutateAsync(values);
      Toast.success('邮件配置保存成功');
    } catch {
      // validation failed
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      Toast.warning('请输入收件邮箱');
      return;
    }
    await testMutation.mutateAsync(testEmail);
    Toast.success('测试邮件发送成功！请检查收件箱');
    setTestModalVisible(false);
    setTestEmail('');
  };

  if (configQuery.isFetching && !config) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container">
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <Title heading={5} style={{ margin: 0 }}>
          邮件配置
        </Title>
        <Text type="tertiary">配置系统发件邮件服务器，用于发送通知、告警等邮件</Text>
      </div>

      <Form
        key={config?.updatedAt ?? 'new'}
        getFormApi={(api) => {
          formApi.current = api;
        }}
        allowEmpty
        labelPosition="left"
        labelWidth={120}
        style={{ width: '100%' }}
        initValues={config
          ? {
              smtpHost: config.smtpHost,
              smtpPort: config.smtpPort,
              smtpUser: config.smtpUser,
              fromName: config.fromName,
              fromEmail: config.fromEmail,
              encryption: config.encryption,
              status: config.status,
            }
          : { encryption: 'ssl', smtpPort: 465, status: 'enabled', fromName: 'Zenith Admin' }}
      >
        <Form.Input
          field="smtpHost"
          label="SMTP 服务器"
          placeholder="例如: smtp.example.com"
          rules={[{ required: true, message: '请输入SMTP服务器地址' }]}
        />
        <Form.InputNumber
          field="smtpPort"
          label="SMTP 端口"
          placeholder="例如: 465"
          min={1}
          max={65535}
          rules={[{ required: true, message: '请输入端口号' }]}
        />
        <Form.Select
          field="encryption"
          label="加密方式"
          placeholder="请选择加密方式"
          style={{ width: '100%' }}
          optionList={[
            { label: '无加密 (None)', value: 'none' },
            { label: 'SSL/TLS', value: 'ssl' },
            { label: 'STARTTLS', value: 'tls' },
          ]}
        />
        <Form.Input
          field="smtpUser"
          label="发件邮箱"
          placeholder="例如: noreply@example.com"
          rules={[{ required: true, message: '请输入发件邮箱' }]}
        />
        <Form.Input field="smtpPassword" label="授权密码" type="password" placeholder="请输入邮箱授权码或密码" />
        <Divider margin="16px 0" />
        <Form.Input field="fromName" label="发件人名称" placeholder="例如: Zenith Admin" />
        <Form.Input field="fromEmail" label="发件人邮箱" placeholder="留空则使用发件邮箱" />
        <Form.Select
          field="status"
          label="状态"
          style={{ width: '100%' }}
          placeholder="请选择状态"
          optionList={[
            { label: '启用', value: 'enabled' },
            { label: '禁用', value: 'disabled' },
          ]}
        />
      </Form>

      {hasPermission('system:email-config:update') && (
        <div style={{ marginTop: 24 }}>
          <Space>
            <Button type="primary" icon={<Save size={14} />} loading={saveMutation.isPending} onClick={handleSave}>
              保存配置
            </Button>
            <Button icon={<Send size={14} />} onClick={() => setTestModalVisible(true)}>
              测试连接
            </Button>
          </Space>
        </div>
      )}

      <AppModal
        title={
          <Space>
            <Mail size={16} />
            发送测试邮件
          </Space>
        }
        visible={testModalVisible}
        onCancel={() => {
          setTestModalVisible(false);
          setTestEmail('');
        }}
        onOk={handleTest}
        okText="发送"
        confirmLoading={testMutation.isPending}
      >
        <div style={{ padding: '8px 0' }}>
          <Text>请输入收件邮箱，系统将发送一封测试邮件：</Text>
          <Input
            style={{ marginTop: 12 }}
            placeholder="请输入收件邮箱"
            value={testEmail}
            onChange={setTestEmail}
          />
        </div>
      </AppModal>
    </div>
    </div>
  );
}

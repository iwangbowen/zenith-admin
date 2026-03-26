import { useState, useEffect, useRef } from 'react';
import { Form, Button, Select, Toast, Space, Spin, Typography, Divider, Modal, Input } from '@douyinfe/semi-ui';
import { Save, Send, Mail } from 'lucide-react';
import type { EmailConfig } from '@zenith/shared';
import { request } from '../../../utils/request';
import { usePermission } from '../../../hooks/usePermission';

const { Title, Text } = Typography;

export default function EmailConfigPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    request
      .get<EmailConfig>('/api/email-config')
      .then((res) => {
        if (res.code === 0 && res.data && formApi.current) {
          formApi.current.setValues({
            smtpHost: res.data.smtpHost,
            smtpPort: res.data.smtpPort,
            smtpUser: res.data.smtpUser,
            smtpPassword: res.data.smtpPassword,
            fromName: res.data.fromName,
            fromEmail: res.data.fromEmail,
            encryption: res.data.encryption,
            status: res.data.status,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!formApi.current) return;
    try {
      const values = await formApi.current.validate();
      setSaveLoading(true);
      const res = await request.put<EmailConfig>('/api/email-config', values);
      if (res.code === 0) {
        Toast.success('邮件配置保存成功');
      } else {
        Toast.error(res.message ?? '保存失败');
      }
    } catch {
      // validation failed
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      Toast.warning('请输入收件邮箱');
      return;
    }
    setTestLoading(true);
    const res = await request.post<null>('/api/email-config/test', { email: testEmail });
    setTestLoading(false);
    if (res.code === 0) {
      Toast.success('测试邮件发送成功！请检查收件箱');
      setTestModalVisible(false);
      setTestEmail('');
    } else {
      Toast.error(res.message ?? '发送失败');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <Title heading={5} style={{ margin: 0 }}>
          邮件配置
        </Title>
        <Text type="tertiary">配置系统发件邮件服务器，用于发送通知、告警等邮件</Text>
      </div>

      <Form
        getFormApi={(api) => {
          formApi.current = api;
        }}
        labelPosition="left"
        labelWidth={120}
        style={{ width: '100%' }}
        initValues={{ encryption: 'ssl', smtpPort: 465, status: 'active', fromName: 'Zenith Admin' }}
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
          optionList={[
            { label: '启用', value: 'active' },
            { label: '禁用', value: 'disabled' },
          ]}
        />
      </Form>

      {hasPermission('system:email-config:update') && (
        <div style={{ marginTop: 24 }}>
          <Space>
            <Button type="primary" icon={<Save size={14} />} loading={saveLoading} onClick={handleSave}>
              保存配置
            </Button>
            <Button icon={<Send size={14} />} onClick={() => setTestModalVisible(true)}>
              测试连接
            </Button>
          </Space>
        </div>
      )}

      <Modal
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
        confirmLoading={testLoading}
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
      </Modal>
    </div>
  );
}

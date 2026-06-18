import { useState, useEffect, useCallback } from 'react';
import {
  Button, Form, Toast, Typography, Tag, Space, Popconfirm,
  Select, Row, Col,
} from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { Plus, Pencil, Trash2, Server, ChevronUp, ChevronDown } from 'lucide-react';
import { request } from '@/utils/request';

export type SshAuthType = 'password' | 'key_path' | 'key_content' | 'agent';

export interface SshProfile {
  id: number;
  userId: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  hasPassword: boolean;
  keyPath: string | null;
  hasKeyContent: boolean;
  hasKeyPassphrase: boolean;
  envVars: Record<string, string>;
  orderNum: number;
  createdAt: string;
  updatedAt: string;
}

interface SshProfileFormData {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key_path' | 'key_content' | 'agent';
  password?: string;
  keyPath?: string;
  keyContent?: string;
  keyPassphrase?: string;
  envVarsText?: string; // "KEY=VALUE" 每行一个
}

interface SshProfilesManagerProps {
  readonly onConnect: (profile: SshProfile) => void;
}

export default function SshProfilesManager({ onConnect }: Readonly<SshProfilesManagerProps>) {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SshProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [formAuthType, setFormAuthType] = useState<'password' | 'key_path' | 'key_content' | 'agent'>('password');

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    const res = await request.get<SshProfile[]>('/api/ssh-profiles');
    setLoading(false);
    if (res.code === 0 && res.data) setProfiles(res.data);
  }, []);

  useEffect(() => { void fetchProfiles(); }, [fetchProfiles]);

  const openCreate = () => {
    setEditingProfile(null);
    setFormAuthType('password');
    setModalVisible(true);
  };

  const openEdit = (profile: SshProfile) => {
    setEditingProfile(profile);
    setFormAuthType(profile.authType);
    setModalVisible(true);
  };

  const handleSave = async (values: SshProfileFormData) => {
    const envVars: Record<string, string> = {};
    for (const line of (values.envVarsText ?? '').split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        if (k) envVars[k] = v;
      }
    }
    const body = {
      name: values.name,
      host: values.host,
      port: values.port ?? 22,
      username: values.username,
      authType: values.authType,
      password: values.password || null,
      keyPath: values.keyPath || null,
      keyContent: values.keyContent || null,
      keyPassphrase: values.keyPassphrase || null,
      envVars,
    };
    setSaving(true);
    let res;
    if (editingProfile) {
      res = await request.put(`/api/ssh-profiles/${editingProfile.id}`, body);
    } else {
      res = await request.post('/api/ssh-profiles', body);
    }
    setSaving(false);
    if (res.code === 0) {
      Toast.success(editingProfile ? '更新成功' : '创建成功');
      setModalVisible(false);
      void fetchProfiles();
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/ssh-profiles/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchProfiles();
    }
  };

  const handleReorder = async (profile: SshProfile, direction: 'up' | 'down') => {
    const idx = profiles.findIndex((p) => p.id === profile.id);
    const other = direction === 'up' ? profiles[idx - 1] : profiles[idx + 1];
    if (!other) return;
    await Promise.all([
      request.put(`/api/ssh-profiles/${profile.id}`, { orderNum: other.orderNum }),
      request.put(`/api/ssh-profiles/${other.id}`, { orderNum: profile.orderNum }),
    ]);
    void fetchProfiles();
  };

  const getInitialValues = (p: SshProfile | null): Partial<SshProfileFormData> => {
    if (!p) return { authType: 'password', port: 22 };
    return {
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      authType: p.authType,
      keyPath: p.keyPath ?? '',
      envVarsText: Object.entries(p.envVars).map(([k, v]) => `${k}=${v}`).join('\n'),
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 标题栏 */}
      <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--semi-color-border)' }}>
        <Typography.Text strong size="small">SSH 连接</Typography.Text>
        <Button size="small" theme="borderless" icon={<Plus size={13} />} onClick={openCreate} />
      </div>

      {/* 配置列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {loading && <Typography.Text type="tertiary" size="small" style={{ padding: 8 }}>加载中...</Typography.Text>}
        {!loading && profiles.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <Typography.Text type="tertiary" size="small">暂无 SSH 配置</Typography.Text>
          </div>
        )}
        {profiles.map((p, idx) => {
          const colorMap: Record<SshAuthType, 'orange' | 'purple' | 'green'> = { password: 'orange', agent: 'purple', key_path: 'green', key_content: 'green' };
          const textMap: Record<SshAuthType, string> = { password: 'PWD', agent: 'AGENT', key_path: 'KEY', key_content: 'KEY' };
          const authTagColor = colorMap[p.authType];
          const authTagText = textMap[p.authType];
          return (
          <div
            key={p.id}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              marginBottom: 4,
              border: '1px solid var(--semi-color-border)',
              background: 'var(--semi-color-bg-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <Server size={12} style={{ flexShrink: 0, color: 'var(--semi-color-primary)' }} />
              <Typography.Text size="small" strong ellipsis style={{ flex: 1, minWidth: 0 }}>{p.name}</Typography.Text>
              <Tag size="small" color={authTagColor} style={{ flexShrink: 0, fontSize: 10 }}>
                {authTagText}
              </Tag>
            </div>
            <Typography.Text type="tertiary" size="small" ellipsis style={{ display: 'block', marginBottom: 6, paddingLeft: 18 }}>
              {p.username}@{p.host}:{p.port}
            </Typography.Text>
            <div style={{ display: 'flex', gap: 2, justifyContent: 'space-between' }}>
              <Button size="small" type="primary" theme="light" style={{ flex: 1 }} onClick={() => onConnect(p)}>连接</Button>
              <Space spacing={2}>
                <Button size="small" theme="borderless" icon={<ChevronUp size={12} />} disabled={idx === 0} onClick={() => void handleReorder(p, 'up')} />
                <Button size="small" theme="borderless" icon={<ChevronDown size={12} />} disabled={idx === profiles.length - 1} onClick={() => void handleReorder(p, 'down')} />
                <Button size="small" theme="borderless" icon={<Pencil size={12} />} onClick={() => openEdit(p)} />
                <Popconfirm title="确定删除此 SSH 配置？" okType="danger" onConfirm={() => void handleDelete(p.id)}>
                  <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={12} />} />
                </Popconfirm>
              </Space>
            </div>
          </div>
          );
        })}
      </div>

      {/* 新建/编辑弹窗 */}
      <AppModal
        title={editingProfile ? '编辑 SSH 配置' : '新建 SSH 配置'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        fullscreenable={false}
        width={680}
        style={{ top: '5vh' }}
        keepDOM={false}
      >
        <Form
          initValues={getInitialValues(editingProfile)}
          onSubmit={(v) => void handleSave(v as SshProfileFormData)}
          labelPosition="left"
          labelWidth={90}
          style={{ padding: '0 8px 8px' }}
        >
          <Form.Input field="name" label="名称" placeholder="我的服务器" rules={[{ required: true, message: '请输入连接名称' }]} />
          <Row gutter={16}>
            <Col span={16}><Form.Input field="host" label="主机地址" placeholder="192.168.1.1 或 example.com" rules={[{ required: true, message: '请输入主机地址' }]} /></Col>
            <Col span={8}><Form.InputNumber field="port" label="端口" min={1} max={65535} style={{ width: '100%' }} /></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="username" label="用户名" placeholder="root" rules={[{ required: true, message: '请输入用户名' }]} /></Col>
            <Col span={12}>
              <Form.Select
                field="authType"
                label="认证方式"
                style={{ width: '100%' }}
                onChange={(v) => setFormAuthType(v as SshAuthType)}
              >
                <Select.Option value="password">密码</Select.Option>
                <Select.Option value="key_path">服务器私钥路径</Select.Option>
                <Select.Option value="key_content">粘贴私钥内容</Select.Option>
                <Select.Option value="agent">SSH Agent</Select.Option>
              </Form.Select>
            </Col>
          </Row>

          {formAuthType === 'password' && (
            <Form.Input
              field="password"
              label="密码"
              type="password"
              placeholder={editingProfile?.hasPassword ? '（已设置，留空保持不变）' : '输入 SSH 密码'}
            />
          )}
          {formAuthType === 'key_path' && (
            <Row gutter={16}>
              <Col span={12}><Form.Input field="keyPath" label="私钥路径" placeholder="~/.ssh/id_rsa" /></Col>
              <Col span={12}><Form.Input field="keyPassphrase" label="私钥口令" type="password" placeholder={editingProfile?.hasKeyPassphrase ? '（已设置）' : '无口令则留空'} /></Col>
            </Row>
          )}
          {formAuthType === 'key_content' && (
            <>
              <Form.TextArea
                field="keyContent"
                label="私钥内容"
                placeholder={editingProfile?.hasKeyContent ? '（已设置，留空保持不变）' : '粘贴 PEM 格式私钥'}
                rows={5}
              />
              <Form.Input field="keyPassphrase" label="私钥口令" type="password" placeholder={editingProfile?.hasKeyPassphrase ? '（已设置）' : '无口令则留空'} />
            </>
          )}
          {formAuthType === 'agent' && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12, marginLeft: 90 }}>
              使用服务端 SSH_AUTH_SOCK 环境变量对应的 ssh-agent。
            </Typography.Text>
          )}

          <Form.TextArea
            field="envVarsText"
            label="环境变量"
            placeholder={'KEY=VALUE\nNODE_ENV=production'}
            rows={3}
          />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12, marginLeft: 90 }}>
            每行一个，格式：KEY=VALUE
          </Typography.Text>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setModalVisible(false)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
          </div>
        </Form>
      </AppModal>
    </div>
  );
}

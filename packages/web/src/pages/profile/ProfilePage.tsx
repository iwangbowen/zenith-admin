import { useState } from 'react';
import {
  Card, Form, Button, Typography, Tabs, TabPane, Toast, Avatar, Tag, Space, Upload, Spin,
} from '@douyinfe/semi-ui';
import { User as UserIcon, Lock } from 'lucide-react';
import type { User } from '@zenith/shared';
import { request } from '../../utils/request';
import { formatDateTime } from '../../utils/date';
import './ProfilePage.css';

const { Title, Text } = Typography;

interface ProfilePageProps {
  readonly user: Omit<User, 'password'>;
  readonly onUserUpdate: (user: Omit<User, 'password'>) => void;
}

export default function ProfilePage({ user, onUserUpdate }: ProfilePageProps) {
  const [profileLoading, setProfileLoading] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  async function handleUpdateProfile(values: { nickname: string; email: string }) {
    setProfileLoading(true);
    const res = await request.put<Omit<User, 'password'>>('/auth/profile', values);
    setProfileLoading(false);
    if (res.code === 0) {
      Toast.success('资料已更新');
      onUserUpdate(res.data);
    }
  }

  async function handleChangePassword(values: { oldPassword: string; newPassword: string; confirmPassword: string }) {
    if (values.newPassword !== values.confirmPassword) {
      Toast.error('两次密码输入不一致');
      return;
    }
    setPwdLoading(true);
    const res = await request.put('/auth/password', {
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
    setPwdLoading(false);
    if (res.code === 0) {
      Toast.success('密码修改成功，请重新登录');
    }
  }

  return (
    <div className="page-container">
      <div className="profile-layout">
        {/* 左侧：头像卡片 */}
        <Card className="profile-avatar-card">
          <div className="profile-avatar-section">
            <Upload
              className="avatar-upload"
              showUploadList={false}
              accept="image/*"
              limit={1}
              customRequest={({ file, onSuccess, onError }) => {
                setAvatarLoading(true);
                const formData = new FormData();
                formData.append('file', file.fileInstance as File);
                request.post<{ url: string }>('/api/files/upload', formData)
                  .then(async (res) => {
                    if (res.code === 0 && res.data?.url) {
                      const profileRes = await request.put<Omit<User, 'password'>>('/auth/profile', { avatar: res.data.url });
                      if (profileRes.code === 0) {
                        onUserUpdate(profileRes.data);
                        Toast.success('头像已更新');
                        onSuccess?.(res);
                      } else {
                        Toast.error(profileRes.message ?? '头像更新失败');
                        onError?.({ status: profileRes.code }, new Event('error'));
                      }
                    } else {
                      Toast.error(res.message ?? '上传失败');
                      onError?.({ status: res.code }, new Event('error'));
                    }
                  })
                  .catch(() => {
                    Toast.error('上传失败，请重试');
                    onError?.({ status: 500 }, new Event('error'));
                  })
                  .finally(() => setAvatarLoading(false));
              }}
            >
              <div className="avatar-upload-trigger">
                {avatarLoading ? (
                  <div className="avatar-loading-wrapper" style={{ width: 80, height: 80 }}>
                    <Spin />
                  </div>
                ) : (
                  <>
                    <Avatar
                      size="extra-large"
                      color="blue"
                      style={{ fontSize: 28, width: 80, height: 80 }}
                      src={user.avatar || undefined}
                    >
                      {!user.avatar && (user.nickname?.charAt(0)?.toUpperCase() || 'U')}
                    </Avatar>
                    <div className="avatar-upload-mask">更换头像</div>
                  </>
                )}
              </div>
            </Upload>
            <Title heading={5} style={{ margin: '12px 0 4px' }}>{user.nickname}</Title>
            <Text type="tertiary" size="small">@{user.username}</Text>
            <div className="profile-meta">
              <Text type="tertiary" size="small">邮箱：{user.email}</Text>
              <Text type="tertiary" size="small">
                角色：{user.roles?.length ? (
                  <Space spacing={4} style={{ display: 'inline-flex' }}>
                    {user.roles.map((r) => <Tag key={r.id} size="small" color="blue">{r.name}</Tag>)}
                  </Space>
                ) : '无角色'}
              </Text>
              <Text type="tertiary" size="small">
                注册时间：{formatDateTime(user.createdAt)}
              </Text>
            </div>
          </div>
        </Card>

        {/* 右侧：表单 */}
        <Card className="profile-form-card">
          <Tabs type="line">
            <TabPane tab={<span><UserIcon style={{ marginRight: 6 }} />基本信息</span>} itemKey="profile">
              <div className="profile-tab-content">
                <Form
                  initValues={{ nickname: user.nickname, email: user.email }}
                  onSubmit={handleUpdateProfile}
                  labelPosition="left"
                  labelWidth={80}
                >
                  <Form.Input
                    field="nickname"
                    label="昵称"
                    rules={[{ required: true, message: '昵称不能为空' }]}
                    style={{ width: 320 }}
                  />
                  <Form.Input
                    field="email"
                    label="邮箱"
                    rules={[
                      { required: true, message: '邮箱不能为空' },
                      { type: 'email', message: '邮箱格式不正确' },
                    ]}
                    style={{ width: 320 }}
                  />
                  <Form.Slot>
                    <Button htmlType="submit" type="primary" loading={profileLoading}>
                      保存修改
                    </Button>
                  </Form.Slot>
                </Form>
              </div>
            </TabPane>

            <TabPane tab={<span><Lock style={{ marginRight: 6 }} />修改密码</span>} itemKey="password">
              <div className="profile-tab-content">
                <Form onSubmit={handleChangePassword} labelPosition="left" labelWidth={80}>
                  <Form.Input
                    field="oldPassword"
                    label="原密码"
                    mode="password"
                    rules={[{ required: true, message: '请输入原密码' }]}
                    style={{ width: 320 }}
                  />
                  <Form.Input
                    field="newPassword"
                    label="新密码"
                    mode="password"
                    rules={[
                      { required: true, message: '请输入新密码' },
                      { min: 6, message: '密码至少6个字符' },
                    ]}
                    style={{ width: 320 }}
                  />
                  <Form.Input
                    field="confirmPassword"
                    label="确认密码"
                    mode="password"
                    rules={[{ required: true, message: '请确认新密码' }]}
                    style={{ width: 320 }}
                  />
                  <Form.Slot>
                    <Button htmlType="submit" type="primary" loading={pwdLoading}>
                      修改密码
                    </Button>
                  </Form.Slot>
                </Form>
              </div>
            </TabPane>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

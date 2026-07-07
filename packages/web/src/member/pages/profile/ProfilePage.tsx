import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Avatar, Button, Input, Modal, Toast } from '@douyinfe/semi-ui';
import { Crown, LogOut, Palette, UserX } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { MemberPage } from '../../components/MemberPage';
import { ThemeColorPicker } from '../../components/ThemeColorPicker';
import { useDeactivateAccount } from '../../hooks/queries';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { member, logout } = useMemberAuth();
  const deactivateMutation = useDeactivateAccount();
  const [deactivateVisible, setDeactivateVisible] = useState(false);
  const [credential, setCredential] = useState('');

  if (!member) return <Navigate to="/login" replace />;

  const needPassword = !!member.hasPassword;

  const handleLogout = () => {
    Modal.confirm({
      title: '退出登录',
      content: '确定要退出当前账户吗？',
      okText: '退出',
      cancelText: '取消',
      onOk: () => {
        logout();
        navigate('/login', { replace: true });
      },
    });
  };

  const handleDeactivate = async () => {
    if (!credential.trim()) {
      Toast.warning(needPassword ? '请输入登录密码' : '请输入短信验证码');
      return;
    }
    await deactivateMutation.mutateAsync(needPassword ? { password: credential } : { smsCode: credential });
    Toast.success('账户已注销');
    logout();
    navigate('/', { replace: true });
  };

  return (
    <MemberPage title="我的资料">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '20px 24px',
          background: '#fff',
          borderRadius: 12,
          border: '1px solid var(--m-border)',
          marginBottom: 16,
        }}
      >
        <Avatar size="large" src={member.avatar ?? undefined} style={{ background: 'var(--m-primary)', flexShrink: 0 }}>
          {member.nickname?.[0] ?? 'U'}
        </Avatar>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{member.nickname ?? '会员'}</div>
          <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>
            {member.phone ?? member.email ?? member.username ?? '—'}
          </div>
        </div>
        {member.levelName && (
          <span className="m-level-badge">
            <Crown size={11} />
            {member.levelName}
          </span>
        )}
      </div>

      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid var(--m-border)',
          padding: '20px 24px',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          <Palette size={16} color="var(--m-primary)" />
          个性化设置
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10, color: 'var(--m-text)' }}>主题颜色</div>
        <ThemeColorPicker />
      </div>

      <Button
        type="danger"
        theme="light"
        icon={<LogOut size={15} />}
        onClick={handleLogout}
      >
        退出登录
      </Button>

      {/* 危险区：注销账户 */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid rgba(250, 81, 81, 0.35)',
          padding: '18px 24px',
          marginTop: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: 'var(--m-danger, #fa5151)', marginBottom: 8 }}>
          <UserX size={16} />
          注销账户
        </div>
        <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
          注销后账户将无法登录，积分、余额与卡券不可再使用；历史记录按合规要求留存。如需恢复请在 30 天内联系客服。
        </div>
        <Button type="danger" theme="borderless" onClick={() => { setCredential(''); setDeactivateVisible(true); }}>
          申请注销
        </Button>
      </div>

      <Modal
        title="确认注销账户"
        visible={deactivateVisible}
        okText="确认注销"
        okButtonProps={{ type: 'danger', theme: 'solid', loading: deactivateMutation.isPending }}
        onOk={() => void handleDeactivate()}
        onCancel={() => setDeactivateVisible(false)}
        closeOnEsc
      >
        <p style={{ marginBottom: 12, color: 'var(--m-text-secondary)', fontSize: 13 }}>
          此操作不可自行撤销。请输入{needPassword ? '登录密码' : '短信验证码'}确认身份：
        </p>
        <Input
          mode={needPassword ? 'password' : undefined}
          placeholder={needPassword ? '登录密码' : '短信验证码'}
          value={credential}
          onChange={setCredential}
        />
      </Modal>
    </MemberPage>
  );
}

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast, Card } from '@douyinfe/semi-ui';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { MemberPage } from '../../components/MemberPage';
import { useChangeMemberPassword } from '../../hooks/queries';

function FieldRow({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="mc-field-row">
      <div className="mc-field-label">{label}</div>
      <div className="mc-field-value">{children}</div>
    </div>
  );
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { member } = useMemberAuth();
  const needOld = member?.hasPassword ?? true;
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const changePasswordMutation = useChangeMemberPassword();

  const handleSave = async () => {
    if (needOld && !oldPassword) {
      Toast.warning('请输入原密码');
      return;
    }
    if (newPassword.length < 6) {
      Toast.warning('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirm) {
      Toast.warning('两次输入的密码不一致');
      return;
    }
    await changePasswordMutation.mutateAsync({
      oldPassword: needOld ? oldPassword : undefined,
      newPassword,
    });
    Toast.success('密码已修改');
    navigate(-1);
  };

  return (
    <MemberPage title={needOld ? '修改密码' : '设置密码'} showBack noTabbar>
      <Card style={{ maxWidth: 520, marginBottom: 16, marginLeft: 'auto', marginRight: 'auto' }}>
        {needOld && (
          <FieldRow label="原密码">
            <Input mode="password" value={oldPassword} onChange={setOldPassword} placeholder="请输入原密码" borderless />
          </FieldRow>
        )}
        <FieldRow label="新密码">
          <Input mode="password" value={newPassword} onChange={setNewPassword} placeholder="至少 6 位" borderless />
        </FieldRow>
        <FieldRow label="确认密码">
          <Input mode="password" value={confirm} onChange={setConfirm} placeholder="再次输入新密码" borderless />
        </FieldRow>
      </Card>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <Button
          theme="solid"
          loading={changePasswordMutation.isPending}
          onClick={handleSave}
          style={{ background: 'var(--m-primary)' }}
        >
          确认修改
        </Button>
      </div>
    </MemberPage>
  );
}

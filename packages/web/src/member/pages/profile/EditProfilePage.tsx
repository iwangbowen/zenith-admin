import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast, Select, Card, Avatar } from '@douyinfe/semi-ui';
import { Camera, X } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { MemberPage } from '../../components/MemberPage';
import { FieldRow } from '../../components/FieldRow';
import { useUpdateMemberProfile, useUploadMemberAvatar } from '../../hooks/queries';
import { AvatarSelectModal } from '@/components/AvatarSelectModal';

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { member, updateMember } = useMemberAuth();
  const [nickname, setNickname] = useState(member?.nickname ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [gender, setGender] = useState<string>(member?.gender ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(member?.avatar ?? null);
  const [avatarSelectVisible, setAvatarSelectVisible] = useState(false);
  const updateProfileMutation = useUpdateMemberProfile();
  const uploadAvatarMutation = useUploadMemberAvatar();

  const handleSave = async () => {
    if (!nickname.trim()) {
      Toast.warning('请输入昵称');
      return;
    }
    const updated = await updateProfileMutation.mutateAsync({
      body: {
        nickname: nickname.trim(),
        email: email || null,
        gender: gender || null,
        avatar: avatarUrl,
      },
    });
    updateMember(updated);
    Toast.success('已保存');
    navigate(-1);
  };

  /** 会员头像上传通道（独立于管理后台文件中心）；裁剪后的 Blob 经此上传 */
  const uploadMemberAvatar = async (blob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('file', blob, 'avatar.jpg');
    const res = await uploadAvatarMutation.mutateAsync(formData);
    if (!res.url) throw new Error('上传失败');
    return res.url;
  };

  return (
    <MemberPage title="编辑资料" showBack noTabbar>
      {/* Avatar area */}
      <Card style={{ maxWidth: 520, marginBottom: 16, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '8px 0 16px' }}>
          <div style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }} onClick={() => setAvatarSelectVisible(true)}>
            <Avatar size="extra-large" src={avatarUrl ?? undefined} style={{ background: 'var(--m-primary)' }}>
              {member?.nickname?.[0] ?? 'U'}
            </Avatar>
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: '50%', background: 'var(--m-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
              <Camera size={12} color="#fff" />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 8 }}>点击头像更换，支持从预设或本地上传（可裁剪）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="small" onClick={() => setAvatarSelectVisible(true)}>更换头像</Button>
              {avatarUrl && (
                <Button size="small" theme="borderless" type="danger" icon={<X size={12} />} onClick={() => setAvatarUrl(null)}>移除</Button>
              )}
            </div>
          </div>
        </div>

        <FieldRow label="昵称">
          <Input value={nickname} onChange={setNickname} placeholder="请输入昵称" borderless />
        </FieldRow>
        <FieldRow label="性别">
          <Select value={gender} onChange={(v) => setGender(v as string)} style={{ width: '100%' }} placeholder="请选择" borderless>
            <Select.Option value="male">男</Select.Option>
            <Select.Option value="female">女</Select.Option>
            <Select.Option value="">保密</Select.Option>
          </Select>
        </FieldRow>
        <FieldRow label="邮箱">
          <Input value={email} onChange={setEmail} placeholder="请输入邮箱" borderless />
        </FieldRow>
      </Card>

      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <Button theme="solid" loading={updateProfileMutation.isPending} onClick={handleSave} style={{ background: 'var(--m-primary)' }}>
          保存
        </Button>
      </div>

      {/* Avatar picker modal（预设 + 本地上传裁剪 + 移除） */}
      <AvatarSelectModal
        visible={avatarSelectVisible}
        currentAvatar={avatarUrl}
        uploadBlob={uploadMemberAvatar}
        onCancel={() => setAvatarSelectVisible(false)}
        onSelect={(url) => {
          setAvatarUrl(url);
          setAvatarSelectVisible(false);
        }}
        onRemove={avatarUrl ? () => {
          setAvatarUrl(null);
          setAvatarSelectVisible(false);
        } : undefined}
      />
    </MemberPage>
  );
}

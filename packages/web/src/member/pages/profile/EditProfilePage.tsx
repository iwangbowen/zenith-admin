import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast, Select, Card, Avatar, Modal, Spin } from '@douyinfe/semi-ui';
import { Camera, X } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { MemberPage } from '../../components/MemberPage';
import { useUpdateMemberProfile, useUploadMemberAvatar } from '../../hooks/queries';

const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar-${String(i + 1).padStart(2, '0')}.svg`);

function FieldRow({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="mc-field-row">
      <div className="mc-field-label">{label}</div>
      <div className="mc-field-value">{children}</div>
    </div>
  );
}

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { member, updateMember } = useMemberAuth();
  const [nickname, setNickname] = useState(member?.nickname ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [gender, setGender] = useState<string>(member?.gender ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(member?.avatar ?? null);
  const [presetVisible, setPresetVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateProfileMutation = useUpdateMemberProfile();
  const uploadAvatarMutation = useUploadMemberAvatar();

  const handleSave = async () => {
    if (!nickname.trim()) {
      Toast.warning('请输入昵称');
      return;
    }
    const updated = await updateProfileMutation.mutateAsync({
      nickname: nickname.trim(),
      email: email || null,
      gender: gender || null,
      avatar: avatarUrl,
    });
    updateMember(updated);
    Toast.success('已保存');
    navigate(-1);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!file.type.startsWith('image/')) { Toast.warning('请选择图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { Toast.warning('图片不能超过 2MB'); return; }
    const formData = new FormData();
    formData.append('file', file);
    const res = await uploadAvatarMutation.mutateAsync(formData);
    if (res.url) {
      setAvatarUrl(res.url);
      setPresetVisible(false);
    }
  };

  const handlePickPreset = (url: string) => {
    setAvatarUrl(url);
    setPresetVisible(false);
  };

  return (
    <MemberPage title="编辑资料" showBack noTabbar>
      {/* Avatar area */}
      <Card style={{ maxWidth: 520, marginBottom: 16, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '8px 0 16px' }}>
          <div style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }} onClick={() => setPresetVisible(true)}>
            {uploadAvatarMutation.isPending ? (
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin />
              </div>
            ) : (
              <Avatar size="extra-large" src={avatarUrl ?? undefined} style={{ background: 'var(--m-primary)' }}>
                {member?.nickname?.[0] ?? 'U'}
              </Avatar>
            )}
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: '50%', background: 'var(--m-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
              <Camera size={12} color="#fff" />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 8 }}>点击头像更换，支持从预设或本地上传</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="small" onClick={() => setPresetVisible(true)}>更换头像</Button>
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

      {/* Avatar picker modal */}
      <Modal
        title="更换头像"
        visible={presetVisible}
        onCancel={() => setPresetVisible(false)}
        footer={null}
        width={480}
        centered
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 12 }}>预设头像</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
            {PRESET_AVATARS.map((url) => (
              <div
                key={url}
                onClick={() => handlePickPreset(url)}
                style={{
                  cursor: 'pointer',
                  borderRadius: '50%',
                  border: avatarUrl === url ? '2px solid var(--m-primary)' : '2px solid transparent',
                  padding: 2,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => { if (avatarUrl !== url) e.currentTarget.style.borderColor = '#ccc'; }}
                onMouseLeave={(e) => { if (avatarUrl !== url) e.currentTarget.style.borderColor = 'transparent'; }}
              >
                <Avatar src={url} size="default" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--m-border)', paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 8 }}>本地上传（≤ 2MB）</div>
          <Button icon={<Camera size={14} />} loading={uploadAvatarMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            选择图片
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      </Modal>
    </MemberPage>
  );
}

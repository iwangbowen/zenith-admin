import { useRef, useState } from 'react';
import {
  Modal, Button, Space, Spin, Cropper, Toast,
} from '@douyinfe/semi-ui';
import { RotateCcw, RotateCw } from 'lucide-react';
import type { User } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserAvatar } from '@/components/UserAvatar';

interface UserAvatarModalProps {
  readonly visible: boolean;
  readonly user: User;
  readonly onClose: () => void;
  readonly onUpdated: (user: User) => void;
}

/** 将图片文件旋转指定角度后返回 data URL */
function createRotatedImage(file: File, angleDeg: number): Promise<string> {
  return new Promise((resolve) => {
    if (angleDeg % 360 === 0) {
      resolve(URL.createObjectURL(file));
      return;
    }
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const rad = (angleDeg * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const w = img.naturalWidth * cos + img.naturalHeight * sin;
      const h = img.naturalWidth * sin + img.naturalHeight * cos;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = objUrl;
  });
}

const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar-${String(i + 1).padStart(2, '0')}.svg`);

export function UserAvatarModal({ visible, user, onClose, onUpdated }: UserAvatarModalProps) {
  const cropperRef = useRef<Cropper>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);

  const [cropperVisible, setCropperVisible] = useState(false);
  const [cropperSrc, setCropperSrc] = useState('');
  const [cropRotate, setCropRotate] = useState(0);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [presetVisible, setPresetVisible] = useState(false);

  function closeCropper() {
    setCropperVisible(false);
    setCropRotate(0);
    originalFileRef.current = null;
    if (cropperSrc) {
      if (cropperSrc.startsWith('blob:')) URL.revokeObjectURL(cropperSrc);
      setCropperSrc('');
    }
  }

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    originalFileRef.current = file;
    setCropperSrc(URL.createObjectURL(file));
    setCropRotate(0);
    setCropperVisible(true);
    e.target.value = '';
  }

  async function handleCropRotate(delta: number) {
    if (!originalFileRef.current) return;
    const newAngle = ((cropRotate + delta) % 360 + 360) % 360;
    setCropRotate(newAngle);
    const rotated = await createRotatedImage(originalFileRef.current, newAngle);
    if (cropperSrc.startsWith('blob:')) URL.revokeObjectURL(cropperSrc);
    setCropperSrc(rotated);
  }

  async function handleCropConfirm() {
    const canvas = cropperRef.current?.getCropperCanvas();
    if (!canvas) return;
    setAvatarLoading(true);
    canvas.toBlob(async (blob) => {
      if (!blob) { setAvatarLoading(false); return; }
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      const uploadRes = await request.post<{ url: string }>('/api/files/upload-one', formData);
      const uploadedUrl = uploadRes.data?.url;
      if (uploadRes.code === 0 && uploadedUrl) {
        const updateRes = await request.put<User>(`/api/users/${user.id}`, { avatar: uploadedUrl });
        if (updateRes.code === 0) {
          onUpdated(updateRes.data);
          Toast.success('头像已更新');
          closeCropper();
          onClose();
        } else {
          Toast.error(updateRes.message ?? '头像更新失败');
        }
      } else {
        Toast.error(uploadRes.message ?? '上传失败');
      }
      setAvatarLoading(false);
    }, 'image/jpeg', 0.85);
  }

  async function handleApplyPreset(url: string) {
    setAvatarLoading(true);
    setPresetVisible(false);
    const res = await request.put<User>(`/api/users/${user.id}`, { avatar: url });
    setAvatarLoading(false);
    if (res.code === 0) { onUpdated(res.data); Toast.success('头像已更新'); onClose(); }
    else Toast.error(res.message ?? '更新失败');
  }

  function handleRemoveAvatar() {
    Modal.confirm({
      title: '确定要移除该用户头像吗？',
      content: '移除后将使用昵称缩写作为默认头像。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        setAvatarLoading(true);
        const res = await request.put<User>(`/api/users/${user.id}`, { avatar: null });
        setAvatarLoading(false);
        if (res.code === 0) { onUpdated(res.data); Toast.success('头像已移除'); onClose(); }
        else Toast.error(res.message ?? '移除失败');
      },
    });
  }

  return (
    <>
      {/* 主弹窗 */}
      <Modal
        title={`管理头像 — ${user.nickname || user.username}`}
        visible={visible}
        onCancel={onClose}
        footer={null}
        width={340}
        centered
        closeOnEsc
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0 16px' }}>
          {avatarLoading ? (
            <div style={{ width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin />
            </div>
          ) : (
            <UserAvatar
              name={user.nickname || user.username}
              avatar={user.avatar}
              semiSize="extra-large"
              size={96}
              style={{ fontSize: 32 }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            <Button
              block
              theme="light"
              loading={avatarLoading}
              onClick={() => avatarInputRef.current?.click()}
            >
              更换头像
            </Button>
            <Button
              block
              theme="borderless"
              onClick={() => setPresetVisible(true)}
            >
              选择预设头像
            </Button>
            {user.avatar && (
              <Button
                block
                theme="borderless"
                type="danger"
                loading={avatarLoading}
                onClick={handleRemoveAvatar}
              >
                移除头像
              </Button>
            )}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarFileSelect}
          />
        </div>
      </Modal>

      {/* 预设头像 Modal */}
      <Modal
        title="选择预设头像"
        visible={presetVisible}
        onCancel={() => setPresetVisible(false)}
        footer={null}
        width={460}
        centered
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '8px 0 16px' }}>
          {PRESET_AVATARS.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => void handleApplyPreset(url)}
              style={{
                border: user.avatar === url ? '2px solid var(--semi-color-primary)' : '2px solid transparent',
                borderRadius: 8, padding: 4, cursor: 'pointer', background: 'var(--semi-color-fill-0)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => { if (user.avatar !== url) e.currentTarget.style.borderColor = 'var(--semi-color-primary-light-hover)'; }}
              onMouseLeave={(e) => { if (user.avatar !== url) e.currentTarget.style.borderColor = 'transparent'; }}
            >
              <img src={url} alt="预设头像" width={72} height={72} style={{ borderRadius: 4, display: 'block' }} loading="lazy" />
            </button>
          ))}
        </div>
      </Modal>

      {/* 裁剪 Modal */}
      <Modal
        title="裁剪头像"
        visible={cropperVisible}
        onCancel={closeCropper}
        footer={
          <Space>
            <Button onClick={closeCropper}>取消</Button>
            <Button type="primary" loading={avatarLoading} onClick={handleCropConfirm}>确认并上传</Button>
          </Space>
        }
        width={520}
        centered
      >
        <div style={{ width: '100%', height: 380 }}>
          {cropperSrc && (
            <Cropper
              ref={cropperRef}
              src={cropperSrc}
              shape="round"
              aspectRatio={1}
              showResizeBox
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12 }}>
          <Button icon={<RotateCcw size={14} />} size="small" theme="borderless" onClick={() => void handleCropRotate(-90)}>向左旋转</Button>
          <Button icon={<RotateCw size={14} />} size="small" theme="borderless" onClick={() => void handleCropRotate(90)}>向右旋转</Button>
        </div>
      </Modal>
    </>
  );
}

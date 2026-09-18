import { Button } from '@douyinfe/semi-ui';
import { Camera } from 'lucide-react';
import { AppModal } from './AppModal';
import { AvatarCropperModal } from './AvatarCropperModal';
import { useAvatarCropUpload } from '@/hooks/useAvatarCropUpload';

/** 系统内置预设头像（public/avatars/avatar-01..12.svg）；BASE_URL 前缀保证子路径部署可用 */
const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `${import.meta.env.BASE_URL}avatars/avatar-${String(i + 1).padStart(2, '0')}.svg`);

export interface AvatarSelectModalProps {
  readonly visible: boolean;
  /** 当前头像地址，用于高亮预设选中项；有值且传了 onRemove 时展示移除入口 */
  readonly currentAvatar?: string | null;
  /** 调用方落库中的 loading（与上传 loading 合并后传给裁剪确认按钮） */
  readonly confirmLoading?: boolean;
  /**
   * 裁剪 Blob 的上传实现（必填）：管理后台传文件中心通道
   *（`utils/avatar-upload.ts` 的 `uploadAvatarBlobToFileCenter`），
   * 会员前台传入自己的上传实现（如会员头像上传接口）。
   */
  readonly uploadBlob: (blob: Blob) => Promise<string>;
  readonly onCancel: () => void;
  /** 选中预设或裁剪上传成功；落库与关闭弹窗由调用方负责 */
  readonly onSelect: (url: string) => void;
  /** 移除头像；不传则不展示移除入口（移除前的确认由调用方负责） */
  readonly onRemove?: () => void;
}

/**
 * 统一头像选择弹窗：预设头像 + 本地上传（选中后进裁剪）+ 移除。
 * 管理后台个人中心、用户管理、会员前台编辑资料三处共用。
 */
export function AvatarSelectModal({ visible, currentAvatar, confirmLoading, uploadBlob, onCancel, onSelect, onRemove }: AvatarSelectModalProps) {
  const avatarUpload = useAvatarCropUpload({
    uploadBlob,
    onUploaded: (url) => {
      onSelect(url);
    },
  });
  const loading = avatarUpload.uploading || (confirmLoading ?? false);

  return (
    <>
      <AppModal
        title="更换头像"
        visible={visible}
        onCancel={onCancel}
        footer={null}
        width={480}
        centered
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)', marginBottom: 12 }}>预设头像</div>
          <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '80px', ['--auto-grid-cols' as string]: 4, ['--auto-grid-gap' as string]: '12px' }}>
            {PRESET_AVATARS.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => onSelect(url)}
                style={{
                  border: currentAvatar === url ? '2px solid var(--semi-color-primary)' : '2px solid transparent',
                  borderRadius: 'var(--semi-border-radius-medium)', padding: 4, cursor: 'pointer', background: 'var(--semi-color-fill-0)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => { if (currentAvatar !== url) e.currentTarget.style.borderColor = 'var(--semi-color-primary-light-hover)'; }}
                onMouseLeave={(e) => { if (currentAvatar !== url) e.currentTarget.style.borderColor = 'transparent'; }}
              >
                <img src={url} alt="预设头像" width={72} height={72} style={{ borderRadius: 'var(--semi-border-radius-small)', display: 'block' }} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)', marginBottom: 8 }}>本地上传（≤ 2MB，上传后可裁剪、旋转、缩放）</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<Camera size={14} />} loading={avatarUpload.uploading} onClick={avatarUpload.openFilePicker}>
              选择图片
            </Button>
            {currentAvatar && onRemove && (
              <Button theme="borderless" type="danger" onClick={onRemove}>
                移除头像
              </Button>
            )}
          </div>
          <input {...avatarUpload.fileInputProps} />
        </div>
      </AppModal>

      <AvatarCropperModal {...avatarUpload.cropperProps} confirmLoading={loading} />
    </>
  );
}

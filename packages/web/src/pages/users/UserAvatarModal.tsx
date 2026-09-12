import { useState } from 'react';
import { Button, Spin, Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { AvatarCropperModal } from '@/components/AvatarCropperModal';
import { PresetAvatarPickerModal } from '@/components/PresetAvatarPickerModal';
import { userContract, type User } from '@zenith/shared/identity';
import { useApiMutation } from '@/lib/contract-query';
import { useAvatarCropUpload } from '@/hooks/useAvatarCropUpload';
import { UserAvatar } from '@/components/UserAvatar';
import { confirmDelete } from '@/utils/confirm';

interface UserAvatarModalProps {
  readonly visible: boolean;
  readonly user: User;
  readonly onClose: () => void;
  readonly onUpdated: (user: User) => void;
}

export function UserAvatarModal({ visible, user, onClose, onUpdated }: UserAvatarModalProps) {
  const [presetVisible, setPresetVisible] = useState(false);
  // 失败提示由调用处按场景给出，请求层静默；code !== 0 由 api() 抛 ApiError
  const updateAvatarMutation = useApiMutation(userContract.update, { requestOptions: { silent: true } });
  const updateAvatar = (avatar: string | null) => updateAvatarMutation.mutateAsync({ params: { id: user.id }, body: { avatar } });
  const avatarUpload = useAvatarCropUpload({
    onUploaded: async (url) => {
      try {
        onUpdated(await updateAvatar(url));
        Toast.success('头像已更新');
        onClose();
      } catch (err) {
        Toast.error(err instanceof Error && err.message ? err.message : '头像更新失败');
        return false;
      }
    },
  });
  const avatarLoading = avatarUpload.uploading || updateAvatarMutation.isPending;

  async function handleApplyPreset(url: string) {
    setPresetVisible(false);
    try {
      onUpdated(await updateAvatar(url));
      Toast.success('头像已更新');
      onClose();
    } catch (err) {
      Toast.error(err instanceof Error && err.message ? err.message : '更新失败');
    }
  }

  function handleRemoveAvatar() {
    confirmDelete({
      title: '确定要移除该用户头像吗？',
      content: '移除后将使用昵称缩写作为默认头像。',
      onOk: async () => {
        try {
          onUpdated(await updateAvatar(null));
          // eslint-disable-next-line no-restricted-syntax -- 头像弹窗使用静默请求并在本地 catch 展示失败
          Toast.success('头像已移除');
          onClose();
        } catch (err) {
          Toast.error(err instanceof Error && err.message ? err.message : '移除失败');
        }
      },
    });
  }

  return (
    <>
      {/* 主弹窗 */}
      <AppModal
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
              onClick={avatarUpload.openFilePicker}
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
          <input {...avatarUpload.fileInputProps} />
        </div>
      </AppModal>

      {/* 预设头像 Modal */}
      <PresetAvatarPickerModal
        visible={presetVisible}
        currentAvatar={user.avatar}
        onCancel={() => setPresetVisible(false)}
        onSelect={(url) => void handleApplyPreset(url)}
      />

      {/* 裁剪 Modal */}
      <AvatarCropperModal {...avatarUpload.cropperProps} confirmLoading={avatarLoading} />
    </>
  );
}

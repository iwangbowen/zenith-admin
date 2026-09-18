import { Toast } from '@douyinfe/semi-ui';
import { AvatarSelectModal } from '@/components/AvatarSelectModal';
import { userContract, type User } from '@zenith/shared/identity';
import { useApiMutation } from '@/lib/contract-query';
import { confirmDelete } from '@/utils/confirm';

interface UserAvatarModalProps {
  readonly visible: boolean;
  readonly user: User;
  readonly onClose: () => void;
  readonly onUpdated: (user: User) => void;
}

export function UserAvatarModal({ visible, user, onClose, onUpdated }: UserAvatarModalProps) {
  // 失败提示由调用处按场景给出，请求层静默；code !== 0 由 api() 抛 ApiError
  const updateAvatarMutation = useApiMutation(userContract.update, { requestOptions: { silent: true } });
  const updateAvatar = (avatar: string | null) => updateAvatarMutation.mutateAsync({ params: { id: user.id }, body: { avatar } });

  async function handleSelect(url: string) {
    try {
      onUpdated(await updateAvatar(url));
      Toast.success('头像已更新');
      onClose();
    } catch (err) {
      Toast.error(err instanceof Error && err.message ? err.message : '头像更新失败');
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
    <AvatarSelectModal
      visible={visible}
      currentAvatar={user.avatar}
      confirmLoading={updateAvatarMutation.isPending}
      onCancel={onClose}
      onSelect={(url) => void handleSelect(url)}
      onRemove={user.avatar ? handleRemoveAvatar : undefined}
    />
  );
}

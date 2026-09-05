/**
 * 授权用户弹窗（站点级数据权限）。
 * 绑定用户后仅超管与授权用户可管理该站点；不绑定则全员（有 CMS 权限者）可管理。
 */
import { useEffect, useRef, useState } from 'react';
import { Select, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { useAllUsers } from '@/hooks/queries/users';
import { useCmsSiteUsers, useSetCmsSiteUsers } from '@/hooks/queries/cms';
import type { CmsSite } from '@zenith/shared/cms';

interface SiteUsersModalProps {
  readonly site: CmsSite | null;
  readonly onClose: () => void;
}

export default function SiteUsersModal({ site, onClose }: Readonly<SiteUsersModalProps>) {
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const initializedFor = useRef<number | null>(null);
  const siteUsersQuery = useCmsSiteUsers(site?.id, !!site);
  const setSiteUsersMutation = useSetCmsSiteUsers();
  const { data: allUsers } = useAllUsers({ enabled: !!site });
  const siteUserIds = siteUsersQuery.data?.userIds;

  // 每次打开只用服务端已授权列表初始化一次，弹窗开着时的后台 refetch 不覆盖编辑中的选择
  useEffect(() => {
    if (!site) {
      initializedFor.current = null;
      setSelectedUserIds([]);
      return;
    }
    if (siteUserIds && initializedFor.current !== site.id) {
      initializedFor.current = site.id;
      setSelectedUserIds(siteUserIds);
    }
  }, [site, siteUserIds]);

  async function handleOk() {
    if (!site) return;
    await setSiteUsersMutation.mutateAsync({ params: { id: site.id }, body: { userIds: selectedUserIds } });
    Toast.success('保存成功');
    onClose();
  }

  return (
    <AppModal
      title={site ? `「${site.name}」授权用户` : '授权用户'}
      visible={!!site}
      onOk={handleOk}
      onCancel={onClose}
      okButtonProps={{ loading: setSiteUsersMutation.isPending, disabled: siteUsersQuery.isFetching }}
      width={520}
      closeOnEsc
    >
      <div style={{ marginBottom: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
        绑定用户后，仅超管与授权用户可管理该站点；不绑定任何用户则全员（有 CMS 权限者）可管理。
      </div>
      <Select
        multiple
        filter
        placeholder="选择授权用户"
        value={selectedUserIds}
        onChange={(v) => setSelectedUserIds((v as number[]) ?? [])}
        style={{ width: '100%' }}
        loading={siteUsersQuery.isFetching}
        optionList={(allUsers ?? []).map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))}
      />
    </AppModal>
  );
}

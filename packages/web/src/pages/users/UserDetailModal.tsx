import { Descriptions, Divider, Empty, Spin } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import DateTimeText from '@/components/DateTimeText';
import DictTag from '@/components/DictTag';
import { SensitiveText } from '@/components/sensitive';
import { RefreshButton } from '@/components/toolbar-controls';
import { UserAvatar } from '@/components/UserAvatar';
import { useUserDetail } from '@/hooks/queries/users';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { EMPTY_PLACEHOLDER } from '@/utils/empty-placeholder';

interface UserDetailModalProps {
  readonly userId: number;
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function UserDetailModal({ userId, visible, onClose }: UserDetailModalProps) {
  const query = useUserDetail(userId, visible);
  const user = query.data?.id === userId ? query.data : undefined;
  const column = useIsMobile() ? 1 : 2;

  return (
    <AppModal title="用户详情" visible={visible} onCancel={onClose} footer={null} width={720}>
      <Spin spinning={visible && query.isFetching}>
        <div style={{ minHeight: 120, wordBreak: 'break-word' }}>
          {query.isError ? (
            <Empty title="用户详情加载失败" description={query.error.message}>
              <RefreshButton onClick={() => void query.refetch()} loading={query.isFetching}>重试</RefreshButton>
            </Empty>
          ) : user ? (
            <>
              <Divider align="left">基本资料</Divider>
              <Descriptions column={column} align="left" data={[
                { key: '头像', value: <UserAvatar name={user.nickname || user.username} avatar={user.avatar} size={40} /> },
                { key: '用户名', value: user.username },
                { key: '昵称', value: user.nickname || EMPTY_PLACEHOLDER },
                { key: '性别', value: <DictTag dictCode="user_gender" value={user.gender} /> },
                { key: '手机号码', value: <SensitiveText entity="User" id={user.id} field="phone" value={user.phone} /> },
                { key: '邮箱', value: <SensitiveText entity="User" id={user.id} field="email" value={user.email} /> },
                { key: '出生日期', value: user.birthDate || EMPTY_PLACEHOLDER },
              ]} />

              <Divider align="left">组织与角色</Divider>
              <Descriptions column={column} align="left" data={[
                { key: '所属部门', value: user.departmentName || EMPTY_PLACEHOLDER, span: column },
                { key: '岗位', value: user.positions?.map((position) => position.name).join('、') || EMPTY_PLACEHOLDER, span: column },
                { key: '角色', value: user.roles.map((role) => role.name).join('、') || EMPTY_PLACEHOLDER, span: column },
              ]} />

              <Divider align="left">账号信息</Divider>
              <Descriptions column={column} align="left" data={[
                { key: '用户 ID', value: user.id },
                { key: '状态', value: <DictTag dictCode="common_status" value={user.status} /> },
                { key: '最近登录', value: <DateTimeText value={user.lastLoginAt} mode="absolute" /> },
                { key: '创建时间', value: <DateTimeText value={user.createdAt} mode="absolute" /> },
                { key: '更新时间', value: <DateTimeText value={user.updatedAt} mode="absolute" /> },
              ]} />
            </>
          ) : !query.isFetching ? <Empty description="暂无用户信息" /> : null}
        </div>
      </Spin>
    </AppModal>
  );
}

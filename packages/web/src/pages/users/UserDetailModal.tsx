import type { ReactNode } from 'react';
import { Empty, Spin, Tag } from '@douyinfe/semi-ui';
import { BriefcaseBusiness, ShieldCheck, UserRound } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import DateTimeText from '@/components/DateTimeText';
import DictTag from '@/components/DictTag';
import { SensitiveText } from '@/components/sensitive';
import { RefreshButton } from '@/components/toolbar-controls';
import { UserAvatar } from '@/components/UserAvatar';
import { useUserDetail } from '@/hooks/queries/users';
import { EMPTY_PLACEHOLDER } from '@/utils/empty-placeholder';
import './UsersPage.css';

interface UserDetailModalProps {
  readonly userId: number;
  readonly visible: boolean;
  readonly onClose: () => void;
}

interface DetailFieldProps {
  readonly label: string;
  readonly value: ReactNode;
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="users-detail-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DetailSection({
  icon,
  title,
  children,
}: Readonly<{ icon: ReactNode; title: string; children: ReactNode }>) {
  return (
    <section className="users-detail-section">
      <div className="users-detail-section-title">
        <span className="users-detail-section-icon">{icon}</span>
        <h3>{title}</h3>
      </div>
      <dl className="users-detail-fields">{children}</dl>
    </section>
  );
}

export function UserDetailModal({ userId, visible, onClose }: UserDetailModalProps) {
  const query = useUserDetail(userId, visible);
  const user = query.data?.id === userId ? query.data : undefined;

  return (
    <AppModal title="用户详情" visible={visible} onCancel={onClose} footer={null} width={760}>
      <Spin spinning={visible && query.isFetching}>
        <div className="users-detail-modal">
          {query.isError ? (
            <Empty title="用户详情加载失败" description={query.error.message}>
              <RefreshButton onClick={() => void query.refetch()} loading={query.isFetching}>重试</RefreshButton>
            </Empty>
          ) : user ? (
            <>
              <header className="users-detail-hero">
                <UserAvatar
                  name={user.nickname || user.username}
                  avatar={user.avatar}
                  size={64}
                  semiSize="large"
                  className="users-detail-avatar"
                />
                <div className="users-detail-identity">
                  <div className="users-detail-name-row">
                    <h2>{user.nickname || user.username}</h2>
                    <DictTag dictCode="common_status" value={user.status} />
                  </div>
                  <div className="users-detail-username">@{user.username}</div>
                  <div className="users-detail-meta">
                    <span className={`users-detail-presence ${user.isOnline ? 'is-online' : ''}`}>
                      <span aria-hidden="true" />{user.isOnline ? '在线' : '离线'}
                    </span>
                    <span className="users-detail-meta-divider" aria-hidden="true" />
                    <span>{user.departmentName || '未分配部门'}</span>
                  </div>
                </div>
                <div className="users-detail-id">
                  <span>用户 ID</span>
                  <strong>#{user.id}</strong>
                </div>
              </header>

              <div className="users-detail-body">
                <DetailSection icon={<UserRound size={15} />} title="基本资料">
                  <DetailField label="昵称" value={user.nickname || EMPTY_PLACEHOLDER} />
                  <DetailField label="性别" value={<DictTag dictCode="user_gender" value={user.gender} />} />
                  <DetailField label="手机号码" value={<SensitiveText entity="User" id={user.id} field="phone" value={user.phone} />} />
                  <DetailField label="邮箱" value={<SensitiveText entity="User" id={user.id} field="email" value={user.email} />} />
                  <DetailField label="出生日期" value={user.birthDate || EMPTY_PLACEHOLDER} />
                </DetailSection>

                <DetailSection icon={<BriefcaseBusiness size={15} />} title="组织与角色">
                  <DetailField label="所属部门" value={user.departmentName || EMPTY_PLACEHOLDER} />
                  <DetailField
                    label="岗位"
                    value={user.positions?.length ? (
                      <span className="users-detail-tags">
                        {user.positions.map((position) => <Tag key={position.id} size="small" color="purple">{position.name}</Tag>)}
                      </span>
                    ) : EMPTY_PLACEHOLDER}
                  />
                  <DetailField
                    label="角色"
                    value={user.roles.length ? (
                      <span className="users-detail-tags">
                        {user.roles.map((role) => <Tag key={role.id} size="small" color="blue">{role.name}</Tag>)}
                      </span>
                    ) : EMPTY_PLACEHOLDER}
                  />
                </DetailSection>

                <DetailSection icon={<ShieldCheck size={15} />} title="账号信息">
                  <DetailField label="用户名" value={<span className="users-detail-mono">{user.username}</span>} />
                  <DetailField label="账号状态" value={<DictTag dictCode="common_status" value={user.status} />} />
                  <DetailField label="最近登录" value={<DateTimeText value={user.lastLoginAt} mode="absolute" />} />
                  <DetailField label="创建时间" value={<DateTimeText value={user.createdAt} mode="absolute" />} />
                  <DetailField label="更新时间" value={<DateTimeText value={user.updatedAt} mode="absolute" />} />
                </DetailSection>
              </div>
            </>
          ) : !query.isFetching ? <Empty description="暂无用户信息" /> : null}
        </div>
      </Spin>
    </AppModal>
  );
}

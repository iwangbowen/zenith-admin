import { useState, type Dispatch, type SetStateAction } from 'react';
import { Badge, Button, Dropdown, Tooltip } from '@douyinfe/semi-ui';
import { ArrowLeftRight, Bell, ChevronDown, Keyboard, Lock, LogOut, Megaphone, MessageSquareHeart, Settings, Smartphone, User as UserIcon, VenetianMask } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { User } from '@zenith/shared/identity';
import { UserAvatar } from '@/components/UserAvatar';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { usePreferences } from '@/hooks/usePreferences';
import { AccountSwitcherModal } from './AccountSwitcher';
import { confirmDanger } from '@/utils/confirm';
import './AccountSwitcher.css';

// 顶栏用户下拉菜单（账号切换 / 个人中心 / 消息 / 设置 / 锁屏 / 退出登录）
export function UserDropdown({
  user,
  navigate,
  unreadCount,
  announcementUnreadCount,
  feedbackEntryEnabled,
  setFeedbackVisible,
  setPrefsVisible,
  setShortcutsVisible,
  enableLockScreen,
  confirmLogout,
  hasPassword,
  lock,
  disconnectWs,
  clearLockPassword,
  onLogout,
}: Readonly<{
  user: Omit<User, 'password'>;
  navigate: NavigateFunction;
  unreadCount: number;
  announcementUnreadCount: number;
  feedbackEntryEnabled: boolean;
  setFeedbackVisible: Dispatch<SetStateAction<boolean>>;
  setPrefsVisible: Dispatch<SetStateAction<boolean>>;
  setShortcutsVisible: Dispatch<SetStateAction<boolean>>;
  enableLockScreen: boolean | undefined;
  confirmLogout: boolean | undefined;
  hasPassword: () => boolean;
  lock: () => void;
  disconnectWs: () => void;
  clearLockPassword: () => void;
  onLogout: () => void;
}>) {
  const { hasEditablePreferences } = usePreferences();
  const { parkedAccounts, impersonation, endImpersonation } = useAuth();
  const { hasAnyPermission } = usePermission();
  // 移动审批轻页首屏即查待办 / 角标 / 可发起流程，无任一审批相关权限必 403；
  // 与意见反馈入口同模式：无权限直接隐藏入口，而不是点进去再报错
  const canUseApproval = hasAnyPermission('workflow:task:handle', 'workflow:instance:list', 'workflow:instance:create');
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const impersonating = impersonation !== null;
  /** 菜单项动作统一先收起下拉菜单，避免面板/弹窗打开后菜单仍浮在上层 */
  const closeAndRun = (fn: () => void) => () => {
    setMenuVisible(false);
    fn();
  };
  return (
    <>
    <AccountSwitcherModal
      visible={switcherVisible}
      onClose={() => setSwitcherVisible(false)}
      navigate={navigate}
      disconnectWs={disconnectWs}
    />
    <Dropdown
      position="bottomRight"
      visible={menuVisible}
      onVisibleChange={setMenuVisible}
      render={
        <Dropdown.Menu>
          {/* 当前账号块 + 账号切换入口（GitHub 风格） */}
          <div className="user-dropdown-account">
            <UserAvatar name={user.nickname || '用户'} avatar={user.avatar} semiSize="default" size={36} />
            <div className="user-dropdown-account-meta">
              <span className="user-dropdown-account-name">{user.nickname}</span>
              <span className="user-dropdown-account-sub">{impersonating ? `模拟登录 · 操作人 ${impersonation.operatorUsername}` : user.username}</span>
            </div>
            {/* 模拟态下不能切换 / 添加账号：模拟身份没有 refresh token，切走即无法回切 */}
            {!impersonating && (
              <Tooltip content="账号切换">
                <Button
                  icon={<ArrowLeftRight size={14} />}
                  theme="borderless"
                  type="tertiary"
                  size="small"
                  aria-label="账号切换"
                  onClick={closeAndRun(() => setSwitcherVisible(true))}
                />
              </Tooltip>
            )}
          </div>
          <Dropdown.Divider />
          <Dropdown.Item icon={<UserIcon size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => navigate('/profile'))}>个人中心</Dropdown.Item>
          <Dropdown.Item
            icon={<Bell size={14} strokeWidth={1.5} />}
            onClick={closeAndRun(() => navigate('/inbox'))}
          >
            我的消息{unreadCount > 0 && <Badge count={unreadCount} overflowCount={99} style={{ marginLeft: 6 }} />}
          </Dropdown.Item>
          <Dropdown.Item icon={<Megaphone size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => navigate('/announcements'))}>公告中心{announcementUnreadCount > 0 && <Badge count={announcementUnreadCount} overflowCount={99} style={{ marginLeft: 6 }} />}</Dropdown.Item>
          {canUseApproval && (
            <Dropdown.Item icon={<Smartphone size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => window.open(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/approval.html`, '_blank'))}>移动审批</Dropdown.Item>
          )}
          {feedbackEntryEnabled && (
            <Dropdown.Item icon={<MessageSquareHeart size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => setFeedbackVisible(true))}>意见反馈</Dropdown.Item>
          )}
          {(hasEditablePreferences || enableLockScreen) && <Dropdown.Item icon={<Settings size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => setPrefsVisible(true))}>偏好设置</Dropdown.Item>}
          <Dropdown.Item icon={<Keyboard size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => setShortcutsVisible(true))}>快捷键</Dropdown.Item>
          {(enableLockScreen ?? false) && hasPassword() && (
            <Dropdown.Item icon={<Lock size={14} strokeWidth={1.5} />} onClick={closeAndRun(() => lock())}>锁屏</Dropdown.Item>
          )}
          <Dropdown.Divider />
          {impersonating ? (
            <Dropdown.Item
              icon={<VenetianMask size={14} strokeWidth={1.5} />}
              onClick={closeAndRun(() => { disconnectWs(); clearLockPassword(); void endImpersonation(); })}
            >
              结束模拟并返回 {impersonation.operatorUsername}
            </Dropdown.Item>
          ) : (
          <Dropdown.Item
            icon={<LogOut size={14} strokeWidth={1.5} />}
            onClick={closeAndRun(() => {
              const doLogout = () => { disconnectWs(); clearLockPassword(); onLogout(); };
              const nextAccount = parkedAccounts[0];
              if (!(confirmLogout ?? true)) {
                doLogout();
                return;
              }
              confirmDanger({
                title: '确认退出',
                content: nextAccount
                  ? `确定要退出当前账号吗？退出后将切换到「${nextAccount.nickname || nextAccount.username}」。`
                  : '确定要退出登录吗？',
                okText: '退出',
                cancelText: '取消',
                onOk: doLogout,
              });
            })}
          >
            退出登录
          </Dropdown.Item>
          )}
        </Dropdown.Menu>
      }
    >
      <div className={`admin-header__user${menuVisible ? ' admin-header__user--open' : ''}`}>
        <UserAvatar name={user.nickname || '用户'} avatar={user.avatar} semiSize="small" size={24} style={{ fontSize: 12 }} />
        <span className="admin-header__username">{user.nickname}</span>
        <ChevronDown size={14} className="admin-header__user-caret" aria-hidden="true" />
      </div>
    </Dropdown>
    </>
  );
}

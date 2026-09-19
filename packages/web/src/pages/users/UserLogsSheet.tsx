/**
 * 用户管理 → 「登录与操作记录」抽屉：把某个用户的登录记录与操作记录并排在一个抽屉里两个 tab。
 *
 * 两个 tab 的内容就是个人中心那两个 tab 抽出来的 `UserLoginLogsPanel` / `UserOperationLogsPanel`，
 * 只把 scope 从「本人」换成「指定 userId」，筛选条、分页、表格（含各自的详情弹窗）与列设置全部复用。
 *
 * tab 只读用户有权限的那几个（登录日志 / 操作日志是两个独立权限码），未激活的 tab 不发请求。
 */
import { useEffect, useState } from 'react';
import { SideSheet, TabPane, Tabs } from '@douyinfe/semi-ui';
import { UserLoginLogsPanel, UserOperationLogsPanel } from '@/components/logs/UserLogsPanels';

type LogsTab = 'login' | 'operation';

interface UserLogsSheetProps {
  /** 目标用户 ID（列表行） */
  readonly userId: number;
  /** 目标用户展示名（昵称（用户名）），仅用于标题 */
  readonly userName: string;
  readonly visible: boolean;
  /** 是否有权限看该用户的登录记录（system:log:login） */
  readonly canViewLoginLogs: boolean;
  /** 是否有权限看该用户的操作记录（system:log:operation） */
  readonly canViewOperationLogs: boolean;
  readonly onClose: () => void;
}

export function UserLogsSheet({
  userId,
  userName,
  visible,
  canViewLoginLogs,
  canViewOperationLogs,
  onClose,
}: UserLogsSheetProps) {
  const firstTab: LogsTab = canViewLoginLogs ? 'login' : 'operation';
  const [activeTab, setActiveTab] = useState<LogsTab>(firstTab);

  // 关闭后回到首个可用 tab：下次打开总是从「登录记录」开始，不会停在上次看过的那一屏
  useEffect(() => {
    if (!visible) setActiveTab(firstTab);
  }, [visible, firstTab]);

  return (
    <SideSheet
      title={`登录与操作记录 · ${userName}`}
      visible={visible}
      onCancel={onClose}
      width={1180}
      bodyStyle={{ padding: '0 16px 16px' }}
      closeOnEsc
    >
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as LogsTab)}>
        {canViewLoginLogs && (
          <TabPane tab="登录记录" itemKey="login">
            <UserLoginLogsPanel
              scope={{ kind: 'user', userId }}
              enabled={visible && activeTab === 'login'}
              columnSettingsKey="user-logs-login-logs"
            />
          </TabPane>
        )}
        {canViewOperationLogs && (
          <TabPane tab="操作记录" itemKey="operation">
            <UserOperationLogsPanel
              scope={{ kind: 'user', userId }}
              enabled={visible && activeTab === 'operation'}
              columnSettingsKey="user-logs-operation-logs"
            />
          </TabPane>
        )}
      </Tabs>
    </SideSheet>
  );
}

export default UserLogsSheet;

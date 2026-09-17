import { PasswordInput } from '@/components/PasswordInput';
import { TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { InAppMessage } from '@zenith/shared/messaging';
import type { UserPreferences } from '@/hooks/usePreferences';
import DateTimeText from '@/components/DateTimeText';

// 导入偏好 Modal（原样迁移自 AdminLayout）
export function ImportPreferencesModal({
  importPrefsVisible,
  setImportPrefsVisible,
  importPrefsText,
  setImportPrefsText,
  handleImportPreferences,
}: Readonly<{
  importPrefsVisible: boolean;
  setImportPrefsVisible: (visible: boolean) => void;
  importPrefsText: string;
  setImportPrefsText: (text: string) => void;
  handleImportPreferences: () => void;
}>) {
  return (
    <AppModal
      title="导入偏好设置"
      visible={importPrefsVisible}
      onCancel={() => {
        setImportPrefsVisible(false);
        setImportPrefsText('');
      }}
      onOk={handleImportPreferences}
      okText="导入"
      cancelText="取消"
      width={480}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Typography.Text type="secondary" size="small">
          粘贴通过「复制偏好」导出的 JSON 配置。未知字段与非法值会被自动忽略，导入后立即生效并同步到服务器。
        </Typography.Text>
        <TextArea
          rows={10}
          value={importPrefsText}
          onChange={(v) => setImportPrefsText(v)}
          placeholder={'{\n  "navLayout": "vertical",\n  "themeColor": "blue",\n  ...\n}'}
        />
      </div>
    </AppModal>
  );
}

// 锁屏密码设置 Modal（原样迁移自 AdminLayout）
export function LockPasswordModal({
  lockPasswordModalMode,
  lockPasswordModalVisible,
  setLockPasswordModalVisible,
  newLockPassword,
  setNewLockPassword,
  confirmLockPassword,
  setConfirmLockPassword,
  setLockPassword,
  setPreferences,
}: Readonly<{
  lockPasswordModalMode: 'set' | 'change';
  lockPasswordModalVisible: boolean;
  setLockPasswordModalVisible: (visible: boolean) => void;
  newLockPassword: string;
  setNewLockPassword: (value: string) => void;
  confirmLockPassword: string;
  setConfirmLockPassword: (value: string) => void;
  setLockPassword: (password: string) => void;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
}>) {
  return (
    <AppModal
      title={lockPasswordModalMode === 'set' ? '设置锁屏密码' : '修改锁屏密码'}
      visible={lockPasswordModalVisible}
      onCancel={() => {
        setLockPasswordModalVisible(false);
        setNewLockPassword('');
        setConfirmLockPassword('');
      }}
      onOk={() => {
        if (!newLockPassword) {
          Toast.warning('请输入密码');
          return;
        }
        if (newLockPassword.length < 4) {
          Toast.warning('密码长度不能少于 4 位');
          return;
        }
        if (newLockPassword !== confirmLockPassword) {
          Toast.warning('两次输入的密码不一致');
          return;
        }
        setLockPassword(newLockPassword);
        setPreferences({ enableLockScreen: true });
        setLockPasswordModalVisible(false);
        setNewLockPassword('');
        setConfirmLockPassword('');
        Toast.success(lockPasswordModalMode === 'set' ? '锁屏密码设置成功' : '锁屏密码修改成功');
      }}
      okText="确定"
      cancelText="取消"
      closeOnEsc
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PasswordInput
          placeholder="请输入密码（至少 4 位）"
          value={newLockPassword}
          onChange={(v) => setNewLockPassword(v)}
        />
        <PasswordInput
          placeholder="请再次输入密码"
          value={confirmLockPassword}
          onChange={(v) => setConfirmLockPassword(v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.currentTarget.closest('.semi-modal')?.querySelector('.semi-button-primary') as HTMLButtonElement | null)?.click();
            }
          }}
        />
      </div>
    </AppModal>
  );
}

// 消息详情 Modal（原样迁移自 AdminLayout）
export function MessageDetailModal({
  selectedMessage,
  setSelectedMessage,
}: Readonly<{
  selectedMessage: InAppMessage | null;
  setSelectedMessage: (message: InAppMessage | null) => void;
}>) {
  return (
    <AppModal
      title={selectedMessage?.title ?? ''}
      visible={selectedMessage !== null}
      onCancel={() => setSelectedMessage(null)}
      footer={null}
      width={640}
      closeOnEsc
    >
      {selectedMessage && (
        <div>
          <div style={{ marginBottom: 12, color: 'var(--semi-color-text-3)', fontSize: 12 }}>
            {selectedMessage.senderName ?? '系统'} · <DateTimeText value={selectedMessage.createdAt} />
          </div>
          <div style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {selectedMessage.content}
          </div>
        </div>
      )}
    </AppModal>
  );
}

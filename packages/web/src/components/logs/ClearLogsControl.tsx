import { PasswordInput } from '@/components/PasswordInput';
import { useContext } from 'react';
import { Button, Dropdown, SplitButtonGroup } from '@douyinfe/semi-ui';
import { ChevronDown, Trash2 } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { ToolbarSlotContext } from '@/components/toolbar-slot-context';
import { CLEAR_LOGS_DAYS, CLEAR_LOGS_LABELS, clearLogsTarget, type ClearLogsControl } from '@/hooks/useClearLogs';

interface ClearLogsButtonsProps {
  loading: boolean;
  /** 触发清除，参数为保留天数（与契约 `days` 一致） */
  onClear: (days: number) => void;
  /** 被清除对象的名称，如「日志」「录屏」 */
  label?: string;
  /** 只有支持 days=0 的日志契约才能启用，避免改变其它复用入口。 */
  allowClearAll?: boolean;
}

/**
 * 清除日志入口：主按钮清除一年前的记录，下拉提供更短的保留档位。
 * 放进工具栏移动端更多菜单时自动平铺为一组按钮，无需另传 mobileActions。
 */
export function ClearLogsButtons({ loading, onClear, label = '日志', allowClearAll = false }: Readonly<ClearLogsButtonsProps>) {
  const toolbarSlot = useContext(ToolbarSlotContext);
  if (toolbarSlot === 'mobile-actions') {
    return (
      <>
        {CLEAR_LOGS_DAYS.map((days) => (
          <Button key={days} type="danger" theme="light" icon={<Trash2 size={14} />} loading={loading} onClick={() => onClear(days)}>
            清除{CLEAR_LOGS_LABELS[days]}的{label}
          </Button>
        ))}
        {allowClearAll && <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={loading} onClick={() => onClear(0)}>清除全部{label}</Button>}
      </>
    );
  }
  return (
    <SplitButtonGroup>
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={loading} onClick={() => onClear(CLEAR_LOGS_DAYS[0])}>清除{label}</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={(
          <Dropdown.Menu>
            {CLEAR_LOGS_DAYS.map((days) => (
              <Dropdown.Item key={days} disabled={loading} onClick={() => onClear(days)}>清除{CLEAR_LOGS_LABELS[days]}的{label}</Dropdown.Item>
            ))}
            {allowClearAll && <Dropdown.Divider />}
            {allowClearAll && <Dropdown.Item type="danger" disabled={loading} onClick={() => onClear(0)}>清除全部{label}</Dropdown.Item>}
          </Dropdown.Menu>
        )}
      >
        <Button type="danger" theme="light" disabled={loading} aria-label={`更多清除${label}选项`} icon={<ChevronDown size={14} />} />
      </Dropdown>
    </SplitButtonGroup>
  );
}

interface ClearLogsModalProps {
  /** 日志名称，如「登录日志」「操作日志」 */
  logName: string;
  control: ClearLogsControl;
}

/** 清除日志二次确认弹窗（管理员密码校验） */
export function ClearLogsModal({ logName, control }: Readonly<ClearLogsModalProps>) {
  return (
    <AppModal
      title={`清除${clearLogsTarget(control.days, logName)}`}
      visible={control.modalVisible}
      onCancel={control.closeModal}
      okText="确认清除"
      okButtonProps={{ type: 'danger', loading: control.verifying }}
      onOk={control.confirmClear}
      maskClosable={false}
    >
      <p style={{ marginBottom: 12 }}>
        此操作将永久删除{clearLogsTarget(control.days, logName)}，不可恢复。
        {control.days === 0 && <>清除范围不受列表筛选条件限制，仅限当前租户视角。</>}
        <br />请输入您的管理员密码以确认：
      </p>
      <PasswordInput
        placeholder="请输入密码"
        value={control.password}
        onChange={control.changePassword}
        onEnterPress={control.confirmClear}
        validateStatus={control.passwordError ? 'error' : undefined}
      />
      {control.passwordError && <p style={{ color: 'var(--semi-color-danger)', marginTop: 4, fontSize: 12 }}>{control.passwordError}</p>}
    </AppModal>
  );
}

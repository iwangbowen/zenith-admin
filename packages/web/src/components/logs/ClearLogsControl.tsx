import { Button, Dropdown, Input, SplitButtonGroup } from '@douyinfe/semi-ui';
import { ChevronDown, Trash2 } from 'lucide-react';
import AppModal from '@/components/AppModal';
import { CLEAR_LOGS_LABELS, type ClearLogsControl } from '@/hooks/useClearLogs';

interface ClearLogsButtonsProps {
  loading: boolean;
  onClear: (months: number) => void;
}

/** 桌面端：清除日志 SplitButton + 月份下拉 */
export function ClearLogsButtons({ loading, onClear }: Readonly<ClearLogsButtonsProps>) {
  return (
    <SplitButtonGroup>
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={loading} onClick={() => onClear(12)}>清除日志</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={(
          <Dropdown.Menu>
            {([12, 6, 3, 1] as const).map((m) => (
              <Dropdown.Item key={m} onClick={() => onClear(m)}>清除{CLEAR_LOGS_LABELS[m]}前的日志</Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item type="danger" onClick={() => onClear(0)}>清除全部日志</Dropdown.Item>
          </Dropdown.Menu>
        )}
      >
        <Button type="danger" theme="light" icon={<ChevronDown size={14} />} />
      </Dropdown>
    </SplitButtonGroup>
  );
}

/** 移动端：平铺的清除日志按钮组 */
export function ClearLogsMobileButtons({ loading, onClear }: Readonly<ClearLogsButtonsProps>) {
  return (
    <>
      {([12, 6, 3, 1] as const).map((m) => (
        <Button key={m} type="danger" theme="light" icon={<Trash2 size={14} />} loading={loading} onClick={() => onClear(m)}>
          清除{CLEAR_LOGS_LABELS[m]}前的日志
        </Button>
      ))}
      <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={loading} onClick={() => onClear(0)}>
        清除全部日志
      </Button>
    </>
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
      title={`清除${control.months === 0 ? '全部' : CLEAR_LOGS_LABELS[control.months] + '前的'}${logName}`}
      visible={control.modalVisible}
      onCancel={control.closeModal}
      okText="确认清除"
      okButtonProps={{ type: 'danger', loading: control.verifying }}
      onOk={control.confirmClear}
      maskClosable={false}
    >
      <p style={{ marginBottom: 12 }}>
        此操作将永久删除{control.months === 0 ? '所有' : CLEAR_LOGS_LABELS[control.months] + '前的'}{logName}，不可恢复。
        <br />请输入您的管理员密码以确认：
      </p>
      <Input
        type="password"
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

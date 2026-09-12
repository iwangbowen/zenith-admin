import { useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { authContract } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';

export const CLEAR_LOGS_LABELS: Record<number, string> = { 30: '一个月前', 90: '三个月前', 180: '六个月前', 365: '一年前' };
/** 手动清除入口提供的保留天数档位（从宽到严），与契约的 `days` 单位一致 */
export const CLEAR_LOGS_DAYS = [365, 180, 90, 30] as const;

interface UseClearLogsOptions {
  /** 执行清除（通常为 mutation 的 mutateAsync） */
  clean: (days: number) => Promise<unknown>;
  /** 清除成功后的回调（如重置分页） */
  onCleared?: () => void;
}

export interface ClearLogsControl {
  modalVisible: boolean;
  days: number;
  password: string;
  passwordError: string;
  verifying: boolean;
  openClearModal: (days: number) => void;
  closeModal: () => void;
  changePassword: (v: string) => void;
  confirmClear: () => Promise<void>;
}

/** 日志清除共享逻辑：保留天数选择 + 管理员密码二次确认 */
export function useClearLogs({ clean, onCleared }: UseClearLogsOptions): ClearLogsControl {
  const [modalVisible, setModalVisible] = useState(false);
  const [days, setDays] = useState(180);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const openClearModal = (d: number) => {
    setDays(d);
    setPassword('');
    setPasswordError('');
    setModalVisible(true);
  };

  const confirmClear = async () => {
    if (!password) { setPasswordError('请输入密码'); return; }
    setVerifying(true);
    try {
      // skipAuth：密码错误返回 401，不得触发 token 刷新 / 退出登录
      await api(authContract.verifyPassword, { body: { password } }, { skipAuth: true });
    } catch {
      setPasswordError('密码错误，请重试'); return;
    } finally {
      setVerifying(false);
    }
    setModalVisible(false);
    await clean(days);
    Toast.success('清除成功');
    onCleared?.();
  };

  return {
    modalVisible,
    days,
    password,
    passwordError,
    verifying,
    openClearModal,
    closeModal: () => setModalVisible(false),
    changePassword: (v: string) => { setPassword(v); setPasswordError(''); },
    confirmClear,
  };
}

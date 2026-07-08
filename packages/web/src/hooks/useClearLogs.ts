import { useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { request } from '@/utils/request';

export const CLEAR_LOGS_LABELS: Record<number, string> = { 0: '全部', 1: '一个月', 3: '三个月', 6: '六个月', 12: '一年' };

interface UseClearLogsOptions {
  /** 执行清除（通常为 mutation 的 mutateAsync） */
  clean: (months: number) => Promise<unknown>;
  /** 清除成功后的回调（如重置分页） */
  onCleared?: () => void;
}

export interface ClearLogsControl {
  modalVisible: boolean;
  months: number;
  password: string;
  passwordError: string;
  verifying: boolean;
  openClearModal: (months: number) => void;
  closeModal: () => void;
  changePassword: (v: string) => void;
  confirmClear: () => Promise<void>;
}

/** 日志清除共享逻辑：月份选择 + 管理员密码二次确认 */
export function useClearLogs({ clean, onCleared }: UseClearLogsOptions): ClearLogsControl {
  const [modalVisible, setModalVisible] = useState(false);
  const [months, setMonths] = useState(0);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const openClearModal = (m: number) => {
    setMonths(m);
    setPassword('');
    setPasswordError('');
    setModalVisible(true);
  };

  const confirmClear = async () => {
    if (!password) { setPasswordError('请输入密码'); return; }
    setVerifying(true);
    try {
      const verifyRes = await request.post('/api/auth/verify-password', { password }, { skipAuth: true });
      if (verifyRes.code !== 0) { setPasswordError('密码错误，请重试'); return; }
    } catch {
      setPasswordError('密码错误，请重试'); return;
    } finally {
      setVerifying(false);
    }
    setModalVisible(false);
    await clean(months);
    Toast.success('清除成功');
    onCleared?.();
  };

  return {
    modalVisible,
    months,
    password,
    passwordError,
    verifying,
    openClearModal,
    closeModal: () => setModalVisible(false),
    changePassword: (v: string) => { setPassword(v); setPasswordError(''); },
    confirmClear,
  };
}

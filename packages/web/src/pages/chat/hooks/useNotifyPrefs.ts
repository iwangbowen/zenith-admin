import { useCallback, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { getChatNotifyPrefs, setChatNotifyPrefs } from '../notifyPrefs';

/** 桌面通知 / 提示音偏好：读写 localStorage，开启桌面通知时申请浏览器权限（自 ChatPage 原样搬移） */
export function useNotifyPrefs() {
  const [notifyDesktop, setNotifyDesktop] = useState(() => getChatNotifyPrefs().desktop);
  const [notifySound, setNotifySound] = useState(() => getChatNotifyPrefs().sound);
  const [notifyPermission, setNotifyPermission] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'default'));

  const handleToggleNotifyDesktop = useCallback(async (checked: boolean) => {
    if (checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      setNotifyPermission(perm);
      if (perm !== 'granted') { Toast.warning('通知权限被拒绝，无法开启桌面通知'); return; }
    }
    setNotifyDesktop(checked);
    setChatNotifyPrefs({ desktop: checked, sound: notifySound });
  }, [notifySound]);

  const handleToggleNotifySound = useCallback((checked: boolean) => {
    setNotifySound(checked);
    setChatNotifyPrefs({ desktop: notifyDesktop, sound: checked });
  }, [notifyDesktop]);

  return { notifyDesktop, notifySound, notifyPermission, handleToggleNotifyDesktop, handleToggleNotifySound };
}

export type NotifyPrefs = ReturnType<typeof useNotifyPrefs>;

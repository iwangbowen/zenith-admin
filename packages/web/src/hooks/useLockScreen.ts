import { useState, useCallback } from 'react';

const LOCK_CREDENTIAL_KEY = 'zenith_lock_credential';
const LOCK_STATE_KEY = 'zenith_is_locked';

export function useLockScreen() {
  const [isLocked, setIsLocked] = useState(() => {
    return localStorage.getItem(LOCK_STATE_KEY) === '1';
  });

  const hasPassword = useCallback(() => {
    return !!localStorage.getItem(LOCK_CREDENTIAL_KEY);
  }, []);

  const setLockPassword = useCallback((password: string) => {
    localStorage.setItem(LOCK_CREDENTIAL_KEY, btoa(encodeURIComponent(password)));
  }, []);

  const clearLockPassword = useCallback(() => {
    localStorage.removeItem(LOCK_CREDENTIAL_KEY);
    localStorage.removeItem(LOCK_STATE_KEY);
    setIsLocked(false);
  }, []);

  const lock = useCallback(() => {
    if (!localStorage.getItem(LOCK_CREDENTIAL_KEY)) return false;
    localStorage.setItem(LOCK_STATE_KEY, '1');
    setIsLocked(true);
    return true;
  }, []);

  const unlock = useCallback((password: string): boolean => {
    const stored = localStorage.getItem(LOCK_CREDENTIAL_KEY);
    if (!stored) {
      setIsLocked(false);
      return true;
    }
    try {
      const isCorrect = decodeURIComponent(atob(stored)) === password;
      if (isCorrect) {
        localStorage.removeItem(LOCK_STATE_KEY);
        setIsLocked(false);
      }
      return isCorrect;
    } catch {
      return false;
    }
  }, []);

  return { isLocked, lock, unlock, setLockPassword, clearLockPassword, hasPassword };
}

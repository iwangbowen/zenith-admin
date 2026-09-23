import { useEffect, useRef, useState, type RefObject } from 'react';

interface VersionedRecord { id: number; version: number }

/** 显示稿与 CAS 基线一起采用；回源永远不能只提升版本号而留下旧表单。 */
export function useCmsEditorBaseline<T extends VersionedRecord>({ record, dirty, saving, saveState, onAdopt, onConflict }: Readonly<{
  record?: T;
  dirty: RefObject<boolean>;
  saving: RefObject<unknown>;
  saveState: string;
  onAdopt: (record: T) => void;
  onConflict: (record: T) => void;
}>) {
  const baseline = useRef<T | undefined>(undefined);
  const callbacks = useRef({ onAdopt, onConflict });
  callbacks.current = { onAdopt, onConflict };
  const force = useRef(false);
  const reportedConflict = useRef<string | null>(null);
  const [resetEpoch, setResetEpoch] = useState(0);
  useEffect(() => {
    if (!record || saving.current) return;
    const previous = baseline.current;
    const changedRecord = !previous || previous.id !== record.id;
    if (!changedRecord && !force.current && record.version <= previous.version) return;
    if (!changedRecord && !force.current && dirty.current) {
      const key = `${record.id}:${record.version}`;
      if (reportedConflict.current !== key) {
        reportedConflict.current = key;
        callbacks.current.onConflict(record);
      }
      return;
    }
    baseline.current = record;
    force.current = false;
    reportedConflict.current = null;
    callbacks.current.onAdopt(record);
  }, [record, dirty, saving, saveState, resetEpoch]);

  return {
    /** 保存成功后确认这份服务端基线；输入期间产生的新修改仍保留在界面。 */
    acknowledge: (saved: T, adopt: boolean) => {
      baseline.current = saved;
      reportedConflict.current = null;
      if (adopt) callbacks.current.onAdopt(saved);
    },
    adoptLatest: () => { force.current = true; setResetEpoch((value) => value + 1); },
  };
}

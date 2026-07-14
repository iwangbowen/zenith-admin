/**
 * 表单设计器本地自动暂存（F02）
 * 编辑中防丢失：变更后 debounce 写入 localStorage，加载时检测未保存草稿提示恢复。
 */
import { useEffect, useRef } from 'react';
import type { WorkflowFormField, WorkflowFormSettings } from '@zenith/shared';

export interface FormDraftPayload {
  name: string;
  fields: WorkflowFormField[];
  settings: WorkflowFormSettings;
  /** 暂存时刻（ISO） */
  savedAt: string;
  /** 暂存时客户端持有的服务端版本号（用于提示草稿是否已落后） */
  revision: number | null;
}

const draftKey = (formId: number | null) => `zenith_form_draft:${formId ?? 'new'}`;

export function loadFormDraft(formId: number | null): FormDraftPayload | null {
  try {
    const raw = localStorage.getItem(draftKey(formId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FormDraftPayload;
    return Array.isArray(parsed?.fields) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearFormDraft(formId: number | null): void {
  try {
    localStorage.removeItem(draftKey(formId));
  } catch {
    /* ignore */
  }
}

interface AutosaveOptions {
  formId: number | null;
  name: string;
  fields: WorkflowFormField[];
  settings: WorkflowFormSettings;
  revision: number | null;
  /** 初始数据加载完成后才开始暂存（避免把空态覆盖到已有草稿上） */
  enabled: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 3000;

export function useFormDraftAutosave({ formId, name, fields, settings, revision, enabled }: AutosaveOptions): { clearDraftNow: () => void } {
  const timerRef = useRef<number | null>(null);
  // 每个存储 key 跳过首次快照（刚加载/刚保存的内容不算用户编辑）
  const primedForRef = useRef<string | null>(null);
  const key = draftKey(formId);

  useEffect(() => {
    if (!enabled) {
      primedForRef.current = null;
      return;
    }
    if (primedForRef.current !== key) {
      primedForRef.current = key;
      return;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const payload: FormDraftPayload = {
        name,
        fields,
        settings,
        savedAt: new Date().toISOString(),
        revision,
      };
      try {
        localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        /* 配额满等场景静默失败 */
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
     
  }, [enabled, key, name, fields, settings, revision]);

  const clearDraftNow = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    // 重新跳过下一次快照（清除后紧跟的状态同步不应立刻重建草稿）
    primedForRef.current = null;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  return { clearDraftNow };
}

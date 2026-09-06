import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSensitiveFieldView } from '@/hooks/queries/data-mask';

export interface UseSensitiveFormFieldsOptions<TRecord extends { id: number }> {
  /** 契约实体名（schema meta.id），如 `User` */
  readonly entity: string;
  /** 表单里属于敏感字段的字段名 */
  readonly fields: readonly string[];
  /** 正在编辑的记录（`useEditModal().editing`）；新增时为 null，此时没有锁定字段 */
  readonly record: TRecord | null;
}

export interface SensitiveFormFieldsControl<TRecord extends { id: number }> {
  readonly entity: string;
  readonly record: TRecord | null;
  /** 该字段当前是否锁定（对当前用户是掩码、且尚未点「修改」） */
  readonly isLocked: (field: string) => boolean;
  /** 该字段是否曾锁定但已解锁（提示「留空则不修改」并提供取消） */
  readonly isUnlocked: (field: string) => boolean;
  readonly unlock: (field: string) => void;
  readonly relock: (field: string) => void;
  /** 提交前剔除锁定字段：它们的值是掩码，写回即数据损坏（服务端也会 400 兜底） */
  readonly strip: <T extends Record<string, unknown>>(values: T) => T;
  readonly canReveal: boolean;
}

/**
 * 编辑表单中敏感字段的锁定编排。
 *
 * 详情按查看者脱敏后回填进表单，非豁免用户看到的是 `138****1234`；原样保存会把掩码写进库。
 * 因此被打码的字段默认**锁定**：只展示掩码 + 「查看 / 修改」入口，用户明确点「修改」后才变成可输入项，
 * 提交时 `strip()` 剔除仍锁定的字段，服务端只更新提交了的字段。
 */
export function useSensitiveFormFields<TRecord extends { id: number }>(
  options: UseSensitiveFormFieldsOptions<TRecord>,
): SensitiveFormFieldsControl<TRecord> {
  const { entity, fields, record } = options;
  const view = useSensitiveFieldView();
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => new Set());
  const recordId = record?.id;

  // 换记录（或从编辑切到新增）时全部重新锁定
  useEffect(() => {
    setUnlocked(new Set());
  }, [recordId]);

  const maskedFields = useMemo(
    () => new Set(record ? fields.filter((field) => view.isMasked(entity, field)) : []),
    [record, fields, view, entity],
  );

  const isLocked = useCallback((field: string) => maskedFields.has(field) && !unlocked.has(field), [maskedFields, unlocked]);
  const isUnlocked = useCallback((field: string) => maskedFields.has(field) && unlocked.has(field), [maskedFields, unlocked]);
  const unlock = useCallback((field: string) => setUnlocked((prev) => new Set(prev).add(field)), []);
  const relock = useCallback((field: string) => setUnlocked((prev) => {
    const next = new Set(prev);
    next.delete(field);
    return next;
  }), []);
  const strip = useCallback(<T extends Record<string, unknown>>(values: T): T => {
    if (maskedFields.size === 0) return values;
    const next = { ...values };
    for (const field of maskedFields) {
      // 锁定字段的值是掩码；解锁后留空表示「不修改」——两种情况都不提交该字段
      const value = next[field];
      if (!unlocked.has(field) || value === undefined || value === null || value === '') delete next[field];
    }
    return next;
  }, [maskedFields, unlocked]);

  return useMemo(() => ({
    entity,
    record,
    isLocked,
    isUnlocked,
    unlock,
    relock,
    strip,
    canReveal: view.canReveal,
  }), [entity, record, isLocked, isUnlocked, unlock, relock, strip, view.canReveal]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevealSensitive, useSensitiveFieldView } from '@/hooks/queries/data-mask';

/** 明文展示时长：到期自动恢复掩码，避免留在屏幕上 */
export const REVEAL_VISIBLE_MS = 30_000;

export interface RevealTarget {
  readonly entity: string;
  readonly id: number;
  readonly field: string;
}

/**
 * 某条记录某个敏感字段的「按需查看明文」状态机：
 * 掩码 → 点击查看（服务端逐次审计）→ 明文（30 秒后或手动收起自动恢复掩码）。
 */
export function useRevealedValue(target: RevealTarget) {
  const view = useSensitiveFieldView();
  const reveal = useRevealSensitive();
  const [revealed, setRevealed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRevealed(null);
  }, []);

  // 切换到另一条记录 / 字段时立即收起
  useEffect(() => hide, [target.entity, target.id, target.field, hide]);

  const show = useCallback(async () => {
    const result = await reveal.mutateAsync({ body: { entity: target.entity, id: target.id, field: target.field } });
    setRevealed(result.value ?? '');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealed(null), REVEAL_VISIBLE_MS);
  }, [reveal, target.entity, target.id, target.field]);

  return {
    /** 当前用户看到的该字段是否为掩码 */
    isMasked: view.isMasked(target.entity, target.field),
    canReveal: view.canReveal,
    revealed,
    revealing: reveal.isPending,
    show,
    hide,
  };
}

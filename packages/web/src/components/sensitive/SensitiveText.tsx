import { Button, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { copyTextWithToast } from '@/utils/clipboard';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { useRevealedValue } from './useRevealedValue';

export interface SensitiveTextProps {
  /** 契约实体名（schema meta.id），如 `User` */
  entity: string;
  /** 记录主键 */
  id: number;
  /** 实体内字段名，如 `phone` */
  field: string;
  /** 服务端返回的值（对当前用户可能已是掩码） */
  value: string | null | undefined;
}

/**
 * 表格 / 详情里的敏感字段文本：原样展示服务端给的值（明文或掩码）；
 * 值被打码且用户拥有「按需查看明文」权限时附带查看按钮，明文展示 30 秒后自动恢复掩码。
 */
export function SensitiveText({ entity, id, field, value }: SensitiveTextProps) {
  const state = useRevealedValue({ entity, id, field });
  if (value == null || value === '') return <Typography.Text type="quaternary">{EMPTY_PLACEHOLDER}</Typography.Text>;
  const showToggle = state.isMasked && state.canReveal;
  const text = state.revealed ?? value;
  return (
    <span className="sensitive-text">
      <Typography.Text>{text}</Typography.Text>
      {showToggle && (
        state.revealed === null ? (
          <Tooltip content="查看明文（记录审计）">
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<Eye size={14} />}
              loading={state.revealing}
              aria-label="查看明文"
              onClick={() => void state.show()}
            />
          </Tooltip>
        ) : (
          <>
            <Tooltip content="复制明文">
              <Button size="small" theme="borderless" type="tertiary" icon={<Copy size={14} />} aria-label="复制明文" onClick={() => void copyTextWithToast(state.revealed ?? '')} />
            </Tooltip>
            <Tooltip content="收起">
              <Button size="small" theme="borderless" type="tertiary" icon={<EyeOff size={14} />} aria-label="收起明文" onClick={state.hide} />
            </Tooltip>
          </>
        )
      )}
    </span>
  );
}

import { useState } from 'react';
import { Button, Tag, Typography } from '@douyinfe/semi-ui';
import { Check, ChevronRight } from 'lucide-react';
import type { ChatMessage, ChatCardAction } from '@zenith/shared';
import { getMessageExtra } from '../utils';

const { Text } = Typography;

type BtnTheme = NonNullable<ChatCardAction['theme']>;

function actionButtonProps(theme: BtnTheme | undefined): { type: 'primary' | 'danger' | 'tertiary'; theme: 'solid' | 'light' | 'borderless' } {
  if (theme === 'primary') return { type: 'primary', theme: 'solid' };
  if (theme === 'danger') return { type: 'danger', theme: 'light' };
  if (theme === 'secondary') return { type: 'primary', theme: 'light' };
  return { type: 'tertiary', theme: 'light' };
}

/** 卡片消息：工作流审批 / 系统告警 / Webhook 推送 */
export function CardMessage({
  msg, onCardAction, onOpenWorkflow,
}: Readonly<{
  msg: ChatMessage;
  onCardAction?: (msg: ChatMessage, action: ChatCardAction) => void;
  /** 工作流卡片点击时打开对应流程详情抽屉 */
  onOpenWorkflow?: (instanceId: number, taskId: number | null) => void;
}>) {
  const card = getMessageExtra(msg)?.card ?? null;
  const [hovered, setHovered] = useState(false);
  if (!card) {
    return (
      <div style={{ padding: '8px 12px', background: 'var(--semi-color-fill-1)', borderRadius: 'var(--semi-border-radius-medium)' }}>
        <Text type="tertiary">卡片数据异常</Text>
      </div>
    );
  }

  const done = card.status === 'done';
  const actions = card.actions ?? [];
  const instanceId = card.instanceId ?? null;
  const taskId = actions.find((a) => a.taskId != null)?.taskId ?? null;
  const clickable = instanceId != null && !!onOpenWorkflow;

  const openWorkflow = () => {
    if (clickable && instanceId != null) onOpenWorkflow?.(instanceId, taskId);
  };

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? openWorkflow : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWorkflow(); } } : undefined}
      onMouseEnter={clickable ? () => setHovered(true) : undefined}
      onMouseLeave={clickable ? () => setHovered(false) : undefined}
      style={{
        minWidth: 260,
        maxWidth: 360,
        background: 'var(--semi-color-bg-2)',
        border: `1px solid ${clickable && hovered ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'}`,
        borderRadius: 'var(--semi-border-radius-large)',
        overflow: 'hidden',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: clickable && hovered ? 'var(--semi-shadow-elevated)' : 'none',
      }}
    >
      {card.cover && (
        <img
          src={card.cover}
          alt={card.title}
          style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }}
        />
      )}
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--semi-color-fill-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          {card.source && (
            <Tag size="small" color="blue" style={{ flexShrink: 0 }}>{card.source}</Tag>
          )}
          <Text strong style={{ fontSize: 14, flex: 1 }}>{card.title}</Text>
          {clickable && (
            <ChevronRight size={16} style={{ flexShrink: 0, color: 'var(--semi-color-text-2)' }} />
          )}
        </div>
        {card.text && (
          <Text style={{ fontSize: 13, color: 'var(--semi-color-text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {card.text}
          </Text>
        )}
      </div>

      {(card.fields ?? []).length > 0 && (
        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(card.fields ?? []).map((f) => (
            <div key={`${f.label}:${f.value}`} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--semi-color-text-2)', flexShrink: 0, minWidth: 56 }}>{f.label}</span>
              <span style={{ color: 'var(--semi-color-text-0)', wordBreak: 'break-word' }}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {(actions.length > 0 || done) && (
        <div style={{ padding: '8px 14px 12px', borderTop: '1px solid var(--semi-color-fill-1)' }}>
          {done ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--semi-color-success)', fontSize: 13 }}>
              <Check size={14} />
              {card.statusText ?? '已处理'}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map((a) => {
                const bp = actionButtonProps(a.theme);
                return (
                  <Button
                    key={a.key}
                    size="small"
                    type={bp.type}
                    theme={bp.theme}
                    onClick={(e) => { e.stopPropagation(); onCardAction?.(msg, a); }}
                  >
                    {a.label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

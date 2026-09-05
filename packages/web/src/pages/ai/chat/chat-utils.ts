/** 智能对话页的常量与纯函数：推理力度选项、建议问题、本地消息 ID、模板变量、侧栏分组、数据库消息 ID 解析 */
import type { AIChatDialogue } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import type { AiConversation } from '@zenith/shared/ai';
import { AI_REASONING_LEVELS } from '@zenith/shared/ai';

export type AIChatDialogueInstance = InstanceType<typeof AIChatDialogue>;

export interface ModelOption { value: string; label: string; source: 'system' | 'user' }

export const DEFAULT_MODEL_OPTIONS: ModelOption[] = [];

/** 会话级推理力度选项:空 = 跟随智能体/服务商配置;provider-default = 显式回到厂商默认 */
const REASONING_LABELS: Record<string, string> = {
  'provider-default': '厂商默认',
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
};
export const REASONING_OPTIONS = [
  { value: '', label: '推理:跟随配置' },
  ...AI_REASONING_LEVELS.map((lv) => ({ value: lv, label: `推理:${REASONING_LABELS[lv] ?? lv}` })),
];

export const SUGGESTED_QUESTIONS = [
  '介绍一下你能做什么',
  '帮我写一封简短的请假邮件',
  '用一句话解释什么是 RBAC 权限模型',
  '把这段话翻译成英文：今天天气很好',
];

let msgIdCounter = 1000;
export function nextMsgId() {
  return `msg-${++msgIdCounter}`;
}

/**
 * 本地消息 ID → 数据库消息 ID。已落库的消息以 `api-${dbId}` 标识（saved 事件映射 / convertApiMessage 生成），
 * 尚未落库的本地气泡（`msg-*`）返回 null。
 */
export function dbIdOf(msgId: string | number | undefined | null): number | null {
  const id = String(msgId);
  return id.startsWith('api-') ? Number(id.replace('api-', '')) : null;
}

/** 提取提示词模板中的 {{变量}} 占位符（去重、保序） */
export function extractPromptVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
  const vars: string[] = [];
  for (const m of matches) {
    if (!vars.includes(m[1])) vars.push(m[1]);
  }
  return vars;
}

/** 会话侧栏行：分组标题 或 会话条目 */
export type ConvRow = { kind: 'header'; label: string } | { kind: 'conv'; conv: AiConversation };

/** 按 置顶 / 今天 / 昨天 / 近 7 天 / 更早 分组 */
export function groupConversations(list: AiConversation[]): ConvRow[] {
  const rows: ConvRow[] = [];
  const today = dayjs().startOf('day');
  let lastLabel: string | null = null;
  for (const conv of list) {
    let label: string;
    if (conv.isPinned) {
      label = '置顶';
    } else {
      const d = dayjs(conv.updatedAt);
      if (!d.isBefore(today)) label = '今天';
      else if (!d.isBefore(today.subtract(1, 'day'))) label = '昨天';
      else if (!d.isBefore(today.subtract(7, 'day'))) label = '近 7 天';
      else label = '更早';
    }
    if (label !== lastLabel) {
      rows.push({ kind: 'header', label });
      lastLabel = label;
    }
    rows.push({ kind: 'conv', conv });
  }
  return rows;
}

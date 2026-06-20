import type { ChatWebhook } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

function token(seed: string): string {
  return `cwh_${seed}${Math.random().toString(36).slice(2, 10)}`;
}

export const mockChatWebhooks: ChatWebhook[] = [
  {
    id: 1,
    name: '监控告警',
    avatar: null,
    description: '运维监控系统的告警推送',
    conversationId: 101,
    conversationName: '产品讨论组',
    enabled: true,
    webhookUrl: '/api/public/chat/webhook/cwh_demo_monitor_0001abcd',
    token: 'cwh_demo_monitor_0001abcd',
    lastUsedAt: mockDateTime(),
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
  {
    id: 2,
    name: 'CI 构建通知',
    avatar: null,
    description: '持续集成构建结果通知',
    conversationId: 101,
    conversationName: '产品讨论组',
    enabled: false,
    webhookUrl: '/api/public/chat/webhook/cwh_demo_ci_0002efgh',
    token: 'cwh_demo_ci_0002efgh',
    lastUsedAt: null,
    createdAt: mockDateTime(),
    updatedAt: mockDateTime(),
  },
];

let nextId = 100;
export function getNextWebhookId(): number {
  nextId += 1;
  return nextId;
}

export function genWebhookToken(seed = 'mock'): string {
  return token(seed);
}

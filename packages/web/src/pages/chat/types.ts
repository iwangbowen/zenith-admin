import type { ChatMessage } from '@zenith/shared';

export interface ChatUser {
  id: number;
  nickname: string;
  username: string;
  avatar?: string | null;
}

export interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

export interface PendingFile {
  id: string;
  file: File;
}

export type SearchDatePreset = '' | 'today' | '7d' | '30d';

export const CHAT_MESSAGE_TYPE_OPTIONS: Array<{ value: ChatMessage['type']; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'file', label: '文件' },
  { value: 'system', label: '系统' },
];

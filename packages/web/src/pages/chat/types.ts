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

export interface UploadingItem {
  /** 本地唯一 ID（负数 / 前缀字符串） */
  id: string;
  type: 'image' | 'file';
  name: string;
  size: number;
  /** 仅 image 类型有效：本地 object URL 用于即时预览 */
  previewUrl?: string;
  mimeType?: string | null;
  convId: number;
  /** 上传进度 0-100，未开始时为 undefined */
  progress?: number;
}

export type SearchDatePreset = '' | 'today' | '7d' | '30d';

export const CHAT_MESSAGE_TYPE_OPTIONS: Array<{ value: ChatMessage['type']; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'file', label: '文件' },
  { value: 'system', label: '系统' },
];

export interface FailedMessage {
  id: string;
  convId: number;
  content: string;
}

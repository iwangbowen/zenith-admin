import type { Dispatch, SetStateAction } from 'react';
import type { ChatConversation, ChatMessage } from '@zenith/shared/chat';
import type { Channel } from '@zenith/shared/messaging';

export type { ChatUser } from '@zenith/shared/chat';

/** React state setter 简写：拆分出的子组件 / hook 与主组件共享同名 setter */
export type Setter<T> = Dispatch<SetStateAction<T>>;

/** 左侧会话列表项：频道与会话合并后的统一条目（仿微信，按消息时间混排） */
export type LeftListItem =
  | { kind: 'channel'; sortTime: number; pinned: boolean; channel: Channel }
  | { kind: 'conv'; sortTime: number; pinned: boolean; conv: ChatConversation };

/** 左栏视图模式：会话列表 / 收藏消息 / 全局搜索 */
export type LeftPaneMode = 'conversations' | 'favorites' | 'globalSearch';

/** 左栏右键菜单状态（会话 / 频道 / 收藏三种目标） */
export type LeftPaneContextMenuState =
  | { x: number; y: number; type: 'conversation'; conv: ChatConversation }
  | { x: number; y: number; type: 'channel'; channel: Channel }
  | { x: number; y: number; type: 'favorite'; msg: ChatMessage };

/** 正在输入用户表（key 为 userId） */
export type TypingUsersMap = Record<number, { nickname: string; timer: ReturnType<typeof setTimeout> }>;

/** 群头像九宫格成员缓存表（key 为会话 id） */
export type GroupAvatarMap = Record<number, Array<{ id: number; nickname: string; avatar?: string | null }>>;


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

/** 单条消息的已读回执信息（仅对自己发送的消息计算） */
export type MessageReadReceipt =
  | { kind: 'direct'; read: boolean }
  | {
      kind: 'group';
      readCount: number;
      total: number;
      readers: Array<{ nickname: string; avatar: string | null }>;
      unreaders: Array<{ nickname: string; avatar: string | null }>;
    };

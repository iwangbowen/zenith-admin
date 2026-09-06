import type { ChannelMessageType } from '@zenith/shared/messaging';

/** 渠道消息类型标签色（自动回复 / 消息模板抽屉共用） */
export const CHANNEL_MESSAGE_TYPE_COLOR: Partial<Record<ChannelMessageType, 'blue' | 'cyan' | 'purple'>> = {
  text: 'blue',
  image: 'cyan',
  news: 'purple',
};
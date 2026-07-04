import { useChatNotifier } from './useChatNotifier';

/**
 * 全局聊天通知宿主（桌面通知 + 提示音）。
 * 以懒加载组件形式承载 useChatNotifier，使聊天相关依赖不进入首屏 chunk。
 */
export default function ChatNotifierHost({ userId }: Readonly<{ userId: number | null }>) {
  useChatNotifier(userId);
  return null;
}

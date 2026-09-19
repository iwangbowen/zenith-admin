import type { Menu } from '../../identity/contracts';
import { SEED_DATE } from '../_base';

/** 会话中心（5000 段） */
export const SEED_MENUS_MESSAGING: Menu[] = [
  { id: 5000, parentId: 0, title: '会话中心', name: 'ChatCenter', path: '/chat', component: 'chat/ChatPage', icon: 'MessagesSquare', type: 'menu', sort: 7, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 规则中心（6000 段）
];

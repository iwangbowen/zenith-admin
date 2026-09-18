import type { Menu } from '../../identity/contracts';
import { SEED_DATE } from '../_base';

/** 顶层入口（首页 / 个人中心 / 公告中心 / 我的消息） */
export const SEED_MENUS_COMMON: Menu[] = [
  { id: 1, parentId: 0, title: '首页', name: 'Dashboard', path: '/', component: 'dashboard/DashboardPage', icon: 'Home', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 系统管理（1000 段）
  { id: 11, parentId: 0, title: '个人中心', name: 'Profile', path: '/profile', component: 'profile/ProfilePage', icon: 'UserRound', type: 'menu', sort: 99, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, parentId: 0, title: '公告中心', name: 'Announcements', path: '/announcements', component: 'announcements/AnnouncementsPage', icon: 'Megaphone', type: 'menu', sort: 100, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, parentId: 0, title: '我的消息', name: 'Inbox', path: '/inbox', component: 'inbox/InboxPage', icon: 'Inbox', type: 'menu', sort: 101, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 搜索中心：固定路由无角色菜单门禁，菜单管理仍可维护其显示元数据。
  { id: 14, parentId: 0, title: '搜索中心', name: 'GlobalSearch', path: '/search', component: 'search/GlobalSearchPage', icon: 'Search', type: 'menu', sort: 102, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

/* eslint-disable react-refresh/only-export-components */
import { Badge } from '@douyinfe/semi-ui';
import {
  ArrowLeft,
  Bell,
  BellRing,
  CalendarCheck,
  Clock,
  Coins,
  Crown,
  Gift,
  History,
  House,
  Lock,
  LogOut,
  MessageSquare,
  PenLine,
  Settings,
  Star,
  Ticket,
  User,
  UserCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface MemberNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  mobile?: boolean;
  mobileLabel?: string;
  mobileIcon?: LucideIcon;
  command?: 'home' | 'logout';
}

export const MEMBER_NAV_ITEMS: MemberNavItem[] = [
  { key: '/home', label: '会员概览', mobileLabel: '首页', icon: House, mobile: true },
  { key: '/points', label: '我的积分', icon: Coins },
  { key: '/wallet', label: '我的钱包', icon: Wallet },
  { key: '/coupons', label: '我的卡券', mobileLabel: '卡券', icon: Ticket, mobile: true },
  { key: '/checkin', label: '每日签到', mobileLabel: '签到', icon: CalendarCheck, mobile: true },
  { key: '/level', label: '等级权益', icon: Crown },
  { key: '/messages', label: '消息中心', mobileLabel: '消息', icon: Bell, mobile: true },
  { key: '/contributions', label: '我的投稿', icon: PenLine },
  { key: '/favorites', label: '我的收藏', icon: Star },
  { key: '/subscriptions', label: '我的关注', icon: BellRing },
  { key: '/my-comments', label: '我的评论', icon: MessageSquare },
  { key: '/view-history', label: '浏览历史', icon: Clock },
  { key: '/invite', label: '邀请有礼', icon: Gift },
  { key: '/profile', label: '个人设置', mobileLabel: '我的', icon: Settings, mobileIcon: User, mobile: true },
  { key: '/profile/edit', label: '编辑资料', icon: UserCog },
  { key: '/profile/password', label: '修改密码', icon: Lock },
  { key: '/login-history', label: '登录历史', icon: History },
  { key: '__home__', label: '返回前台', icon: ArrowLeft, command: 'home' },
  { key: '__logout__', label: '退出登录', icon: LogOut, command: 'logout' },
];

const routeItems = MEMBER_NAV_ITEMS.filter((item) => !item.command);

export function getSelectedMemberNavKey(pathname: string): string {
  const exact = routeItems.find((item) => item.key === pathname);
  if (exact) return exact.key;
  if (pathname.startsWith('/profile')) return '/profile/edit';
  const prefix = routeItems.find((item) => pathname.startsWith(`${item.key}/`));
  return prefix?.key ?? '/home';
}

export function MemberNavIcon({
  item,
  active: _active,
  unread = 0,
  size,
}: {
  item: MemberNavItem;
  active?: boolean;
  unread?: number;
  size: number;
}) {
  const Icon = size === 20 && item.mobileIcon ? item.mobileIcon : item.icon;
  const icon = <Icon size={size} />;
  return item.key === '/messages' && unread > 0
    ? <Badge count={unread > 99 ? '99+' : unread} type="danger">{icon}</Badge>
    : icon;
}

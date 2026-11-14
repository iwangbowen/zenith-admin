import { definePermissions } from '../core/permissions';

/**
 * member 域权限码注册表：code → 按钮标题 / 所属页面（菜单 name）。
 * 种子 button 节点由此生成（@zenith/shared/seed），契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const MEMBER_PERMISSIONS = definePermissions({
  'member:dashboard:view': { label: '查询', menu: 'MemberDashboard' },
  'member:member:list': { label: '查询', menu: 'MemberList' },
  'member:member:export-raw': { label: '明文导出', menu: 'MemberList', riskLevel: 'critical', approvalPolicy: 'two_person', reviewIntervalDays: 30 },
  'member:member:create': { label: '新增会员', menu: 'MemberList' },
  'member:member:update': { label: '编辑会员', menu: 'MemberList' },
  'member:member:delete': { label: '删除会员', menu: 'MemberList' },
  'member:level:list': { label: '查询', menu: 'MemberLevels' },
  'member:level:create': { label: '新增等级', menu: 'MemberLevels' },
  'member:level:update': { label: '编辑等级', menu: 'MemberLevels' },
  'member:level:delete': { label: '删除等级', menu: 'MemberLevels' },
  'member:point:list': { label: '查询', menu: 'MemberPoints' },
  'member:point:adjust': { label: '调整积分', menu: 'MemberPoints' },
  'member:wallet:list': { label: '查询', menu: 'MemberWallets' },
  'member:wallet:adjust': { label: '调整余额', menu: 'MemberWallets' },
  'member:wallet:refund': { label: '退款', menu: 'MemberWallets' },
  'member:coupon:list': { label: '查询', menu: ['Coupons', 'CouponRecords'] },
  'member:coupon:create': { label: '新增优惠券', menu: 'Coupons' },
  'member:coupon:update': { label: '编辑优惠券', menu: 'Coupons' },
  'member:coupon:delete': { label: '删除优惠券', menu: 'Coupons' },
  'member:coupon:issue': { label: '发放优惠券', menu: 'Coupons' },
  'member:coupon:revoke': { label: '作废券码', menu: 'Coupons' },
  'member:checkin:rule:list': { label: '查询', menu: 'CheckinRules' },
  'member:checkin:rule:create': { label: '新增规则', menu: 'CheckinRules' },
  'member:checkin:rule:update': { label: '编辑规则', menu: 'CheckinRules' },
  'member:checkin:rule:delete': { label: '删除规则', menu: 'CheckinRules' },
  'member:checkin:setting:update': { label: '签到设置', menu: 'CheckinRules' },
  'member:checkin:log:list': { label: '查询', menu: 'CheckinLogs' },
  'member:checkin:makeup': { label: '会员补签', menu: 'CheckinLogs' },
  'member:checkin:milestone:list': { label: '查询', menu: 'CheckinMilestones' },
  'member:checkin:milestone:create': { label: '新增里程碑', menu: 'CheckinMilestones' },
  'member:checkin:milestone:update': { label: '编辑里程碑', menu: 'CheckinMilestones' },
  'member:checkin:milestone:delete': { label: '删除里程碑', menu: 'CheckinMilestones' },
  'member:loginlog:list': { label: '查询', menu: 'MemberLoginLogs' },
  'member:recharge:list': { label: '查询', menu: 'MemberRecharges' },
  'member:recharge:export-raw': { label: '明文导出', menu: 'MemberRecharges', riskLevel: 'critical', approvalPolicy: 'two_person', reviewIntervalDays: 30 },
});

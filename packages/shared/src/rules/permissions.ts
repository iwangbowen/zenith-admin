import { definePermissions } from '../core/permissions';

/**
 * rules 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const RULES_PERMISSIONS = definePermissions({
  'rule:table:list': { label: '查询', menu: ['RuleTables', 'RuleExecutions'] },
  'rule:table:create': { label: '新增决策表', menu: 'RuleTables' },
  'rule:table:update': { label: '编辑决策表', menu: 'RuleTables' },
  'rule:table:delete': { label: '删除决策表', menu: 'RuleTables' },
  'rule:table:publish': { label: '发布决策表', menu: 'RuleTables' },
  'rule:table:evaluate': { label: '求值测试', menu: 'RuleTables' },
  'rule:table:approve': { label: '审批发布', menu: 'RuleTables' },
  'rule:flow:list': { label: '查询', menu: 'RuleFlows' },
  'rule:flow:create': { label: '新增决策流', menu: 'RuleFlows' },
  'rule:flow:update': { label: '编辑决策流', menu: 'RuleFlows' },
  'rule:flow:delete': { label: '删除决策流', menu: 'RuleFlows' },
  'rule:flow:publish': { label: '发布决策流', menu: 'RuleFlows' },
  'rule:flow:evaluate': { label: '决策流求值', menu: 'RuleFlows' },
  'rule:list:list': { label: '查询', menu: 'RuleLists' },
  'rule:list:create': { label: '新增名单', menu: 'RuleLists' },
  'rule:list:update': { label: '编辑名单', menu: 'RuleLists' },
  'rule:list:delete': { label: '删除名单', menu: 'RuleLists' },
  'rule:list:item': { label: '条目管理', menu: 'RuleLists' },
  'rule:scorecard:list': { label: '查询', menu: 'RuleScorecards' },
  'rule:scorecard:create': { label: '新增评分卡', menu: 'RuleScorecards' },
  'rule:scorecard:update': { label: '编辑评分卡', menu: 'RuleScorecards' },
  'rule:scorecard:delete': { label: '删除评分卡', menu: 'RuleScorecards' },
  'rule:scorecard:publish': { label: '发布评分卡', menu: 'RuleScorecards' },
  'rule:scorecard:evaluate': { label: '评分卡求值', menu: 'RuleScorecards' },
});

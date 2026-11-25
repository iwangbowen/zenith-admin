import { definePermissions } from '../core/permissions';

/**
 * marketing 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const MARKETING_PERMISSIONS = definePermissions({
  'marketing:campaign:list': { label: '查询', menu: 'GrowthMarketingCampaigns' },
  'marketing:campaign:create': { label: '新增活动', menu: 'GrowthMarketingCampaigns' },
  'marketing:campaign:update': { label: '编辑活动', menu: 'GrowthMarketingCampaigns' },
  'marketing:campaign:delete': { label: '删除活动', menu: 'GrowthMarketingCampaigns' },
  'marketing:campaign:publish': { label: '发布/结束', menu: 'GrowthMarketingCampaigns' },
  'marketing:record:list': { label: '参与记录', menu: 'GrowthMarketingCampaigns' },
});

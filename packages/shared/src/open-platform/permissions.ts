import { definePermissions } from '../core/permissions';

/**
 * open-platform 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const OPEN_PLATFORM_PERMISSIONS = definePermissions({
  'system:oauth2-apps:view': { label: '查询', menu: 'SystemOAuth2Apps' },
  'system:oauth2-apps:manage': { label: '管理应用', menu: 'SystemOAuth2Apps' },
  'open:scope:view': { label: '查询', menu: 'OpenApiScopes' },
  'open:scope:manage': { label: '管理 Scope', menu: 'OpenApiScopes' },
  'open:rate-plan:view': { label: '查询', menu: 'OpenRatePlans' },
  'open:rate-plan:manage': { label: '管理套餐', menu: 'OpenRatePlans' },
  'open:stats:view': { label: '查询', menu: 'OpenApiStats' },
  'open:signature:use': { label: '查询', menu: 'OpenSignature' },
  'open:webhook:view': { label: '查询', menu: 'OpenWebhooks' },
  'open:webhook:manage': { label: '管理 Webhook', menu: 'OpenWebhooks' },
  'open:sdk:view': { label: '查询', menu: 'OpenSdk', uiOnly: true },
});

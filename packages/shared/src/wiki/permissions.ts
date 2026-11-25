import { definePermissions } from '../core/permissions';

/**
 * wiki 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const WIKI_PERMISSIONS = definePermissions({
  'wiki:doc:list': { label: '查询', menu: 'WikiDocCenter' },
  'wiki:doc:create': { label: '新增文档', menu: 'WikiDocCenter' },
  'wiki:doc:edit': { label: '编辑文档', menu: 'WikiDocCenter' },
  'wiki:doc:delete': { label: '删除文档', menu: 'WikiDocCenter' },
  'wiki:doc:publish': { label: '提交发布', menu: 'WikiDocCenter' },
  'wiki:doc:move': { label: '移动文档', menu: 'WikiDocCenter' },
  'wiki:space:list': { label: '查询', menu: 'WikiSpaces' },
  'wiki:space:create': { label: '新增空间', menu: 'WikiSpaces' },
  'wiki:space:edit': { label: '编辑空间', menu: 'WikiSpaces' },
  'wiki:space:delete': { label: '删除空间', menu: 'WikiSpaces' },
  'wiki:space:grant': { label: '成员授权', menu: 'WikiSpaces' },
  'wiki:approval:list': { label: '查询', menu: 'WikiApprovals' },
  'wiki:approval:review': { label: '审核', menu: 'WikiApprovals' },
  'wiki:template:list': { label: '查询', menu: 'WikiTemplates' },
  'wiki:template:create': { label: '新增模板', menu: 'WikiTemplates' },
  'wiki:template:edit': { label: '编辑模板', menu: 'WikiTemplates' },
  'wiki:template:delete': { label: '删除模板', menu: 'WikiTemplates' },
  'wiki:tag:list': { label: '查询', menu: 'WikiTags' },
  'wiki:tag:create': { label: '新增标签', menu: 'WikiTags' },
  'wiki:tag:edit': { label: '编辑标签', menu: 'WikiTags' },
  'wiki:tag:delete': { label: '删除标签', menu: 'WikiTags' },
  'wiki:comment:list': { label: '查询', menu: 'WikiComments' },
  'wiki:comment:audit': { label: '审核评论', menu: 'WikiComments' },
  'wiki:comment:delete': { label: '删除评论', menu: 'WikiComments' },
  'wiki:recycle:list': { label: '查询', menu: 'WikiRecycle' },
  'wiki:recycle:restore': { label: '还原文档', menu: 'WikiRecycle' },
  'wiki:recycle:purge': { label: '彻底删除', menu: 'WikiRecycle' },
  'wiki:stats:view': { label: '查询', menu: 'WikiStats' },
  'wiki:setting:view': { label: '查询', menu: 'WikiSettings' },
  'wiki:setting:edit': { label: '编辑设置', menu: 'WikiSettings' },
  'wiki:governance:list': { label: '查询', menu: 'WikiGovernance' },
  'wiki:governance:remind': { label: '提醒负责人', menu: 'WikiGovernance' },
  'wiki:governance:archive': { label: '归档', menu: 'WikiGovernance' },
  'wiki:governance:edit': { label: '治理编辑', menu: 'WikiGovernance' },
});

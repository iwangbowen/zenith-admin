import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MENU_TYPES } from '../constants';
import { createMenuSchema, updateMenuSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 菜单节点字段（不含子树）；树形响应在此基础上递归挂 children */
export const menuFieldsSchema = z.object({
  id: z.int(),
  parentId: z.int().meta({ example: 0 }),
  title: z.string().meta({ example: '系统管理' }),
  name: z.string().optional(),
  path: z.string().optional(),
  component: z.string().optional(),
  icon: z.string().optional(),
  type: z.enum(MENU_TYPES).meta({ example: 'menu' }),
  permission: z.string().optional(),
  query: z.string().nullable().optional(),
  isExternal: z.boolean().optional(),
  embed: z.boolean().optional().meta({ description: '外链打开方式：false=新窗口，true=iframe 内嵌' }),
  keepAlive: z.boolean().optional().meta({ description: '页面缓存：多页签模式下切走保留组件状态' }),
  sort: z.int().meta({ example: 1 }),
  status: entityStatusSchema,
  visible: z.boolean().meta({ example: true }),
  featureKey: z.string().nullable().optional().meta({ description: '所属可授权功能（null = 核心能力，不受 License / 套餐限制）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** 递归类型需要显式命名，声明文件才能保留 children 的元素类型 */
export interface Menu extends z.infer<typeof menuFieldsSchema> {
  children?: Menu[];
}

export const menuSchema: z.ZodType<Menu> = menuFieldsSchema
  .extend({
    get children() {
      return z.array(menuSchema).optional();
    },
  })
  .meta({ id: 'Menu' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const menuContract = defineContract('/api/menus', {
  userTree: op.get('/user', { access: 'authenticated', response: z.array(menuSchema), summary: '当前用户可见菜单树' }),
  paths: op.get('/paths', { access: 'authenticated', response: z.array(z.string()), summary: '全部启用页面路径（用于 403/404 判别，不暴露权限与按钮）' }),
  tree: op.get('/', { access: { permission: 'system:menu:list' }, response: z.array(menuSchema), summary: '菜单树（管理用）' }),
  flat: op.get('/flat', { access: { permission: 'system:menu:list' }, response: z.array(menuSchema), summary: '平铺菜单列表' }),
  detail: op.get('/{id}', { access: { permission: 'system:menu:list' }, params: idParam, response: menuSchema, summary: '获取菜单详情' }),
  create: op.post('/', { access: { permission: 'system:menu:create', platformOnly: 'multi-tenant' }, audit: '创建菜单', body: createMenuSchema, response: menuSchema, summary: '新增菜单' }),
  update: op.put('/{id}', { access: { permission: 'system:menu:update', platformOnly: 'multi-tenant' }, audit: '更新菜单', params: idParam, body: updateMenuSchema, response: menuSchema, summary: '更新菜单' }),
  remove: op.delete('/{id}', { access: { permission: 'system:menu:delete', platformOnly: 'multi-tenant' }, audit: '删除菜单', params: idParam, summary: '删除菜单及子菜单' }),
}, { auditModule: '菜单管理', tags: ['Menus'] });

/**
 * 菜单相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const MenuDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    parentId: z.number().int().openapi({ example: 0 }),
    title: z.string().openapi({ example: '系统管理' }),
    name: z.string().optional(),
    path: z.string().optional(),
    component: z.string().optional(),
    icon: z.string().optional(),
    type: z.enum(['directory', 'menu', 'button']).openapi({ example: 'menu' }),
    permission: z.string().optional(),
    query: z.string().nullable().optional(),
    isExternal: z.boolean().optional(),
    sort: z.number().int().openapi({ example: 1 }),
    status: z.enum(['enabled', 'disabled']),
    visible: z.boolean().openapi({ example: true }),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(MenuDTO).optional();
    },
  })
  .openapi('Menu');

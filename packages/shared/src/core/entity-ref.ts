import * as z from 'zod';

/**
 * 统一对象引用的基础原语。
 *
 * 这里刻意只描述跨运行时可传输的值，不引用任何 platform 或业务域类型。
 * 具体业务域的 EntityType 注册在 `@zenith/shared/platform`，因此 core 可以被
 * platform、server、web 和 SDK 同时依赖而不会形成反向依赖。
 */

/** EntityType 使用小写域名，并以点或短横线分隔层级，例如 `payment.order`。 */
export const entityTypeSchema = z.string()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .meta({ id: 'EntityType', description: '规范化对象类型（小写域名）', example: 'payment.order' });

export type EntityType = z.infer<typeof entityTypeSchema>;

/** 对象主键是不透明字符串，可表达数字 ID、UUID 或复合业务键。 */
export const entityKeySchema = z.string()
  .min(1)
  .max(512)
  .meta({ id: 'EntityKey', description: '对象主键或复合业务键', example: 'ord_01J8Q7W3' });

export type EntityKey = z.infer<typeof entityKeySchema>;

/** 关系分组键使用命名空间，避免不同来源的分组发生碰撞。 */
export const relationKeySchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .meta({ id: 'RelationKey', description: '命名空间化关系分组键', example: 'payment.order.refunds' });

export type RelationKey = z.infer<typeof relationKeySchema>;

/** 跨域关联的稳定引用；不携带 tenant，租户始终由服务端上下文决定。 */
export const entityRefSchema = z.object({
  type: entityTypeSchema,
  key: entityKeySchema,
}).meta({ id: 'EntityRef' });

export type EntityRef = z.infer<typeof entityRefSchema>;

export const SUBJECT_REF_ROLES = ['primary', 'related', 'source', 'target'] as const;
export const subjectRefRoleSchema = z.enum(SUBJECT_REF_ROLES).meta({ id: 'SubjectRefRole' });
export type SubjectRefRole = z.infer<typeof subjectRefRoleSchema>;

/** 审计 / 事件中对象的角色化引用。 */
export const subjectRefSchema = entityRefSchema.extend({
  role: subjectRefRoleSchema.default('related'),
}).meta({ id: 'SubjectRef' });

export type SubjectRef = z.infer<typeof subjectRefSchema>;


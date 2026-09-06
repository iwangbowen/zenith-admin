import { pgTable, varchar, timestamp, pgEnum, boolean, unique, jsonb, integer } from 'drizzle-orm/pg-core';
import { MASK_TYPES, type CustomMaskRule } from '@zenith/shared/core';
import { auditColumns } from './core';

export const maskTypeEnum = pgEnum('mask_type', MASK_TYPES);

/**
 * 数据脱敏策略（覆盖记录）。
 *
 * 敏感字段本身由 `@zenith/shared` 契约实体的 `sensitive()` 声明，服务端在契约路由出口按声明打码；
 * 本表只保存管理员对某个字段「与契约默认不同」的策略：换脱敏类型 / 自定义规则 / 豁免权限 / 停用。
 * 没有记录的字段按契约默认类型脱敏，仅平台超管免脱敏。
 */
export const dataMaskPolicies = pgTable('data_mask_policies', {
  id:                integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 契约实体名（schema meta.id），如 User / Member */
  entity:            varchar({ length: 64 }).notNull(),
  /** 实体内字段路径，嵌套以 . 连接，如 phone / initialAdmin.email */
  field:             varchar({ length: 64 }).notNull(),
  maskType:          maskTypeEnum().notNull(),
  /** 自定义规则（maskType='custom' 时使用）：{ prefixKeep, suffixKeep, maskChar? } */
  customRule:        jsonb().$type<CustomMaskRule | null>(),
  /** 拥有任一权限码即看到明文；平台超管无需配置 */
  exemptPermissions: jsonb().$type<string[]>().notNull().default([]),
  enabled:           boolean().notNull().default(true),
  remark:            varchar({ length: 256 }),
  ...auditColumns(),
  createdAt:         timestamp().defaultNow().notNull(),
  updatedAt:         timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('data_mask_policies_entity_field_unique').on(t.entity, t.field)]);

export type DataMaskPolicyRow = typeof dataMaskPolicies.$inferSelect;

export type NewDataMaskPolicy = typeof dataMaskPolicies.$inferInsert;

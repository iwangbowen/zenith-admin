import * as z from 'zod';
import { RULE_ASSET_VERSION_KINDS, RULE_USAGE_TYPES } from '../constants';

/** 规则资产引用方（where-used 分析） */
export const ruleUsageItemSchema = z.object({
  type: z.enum(RULE_USAGE_TYPES),
  id: z.int().nullable(),
  name: z.string(),
  status: z.string().nullable().optional(),
}).meta({ id: 'RuleUsage' });

export type RuleUsageItem = z.infer<typeof ruleUsageItemSchema>;

/** 资产版本快照（决策流 / 评分卡通用） */
export const ruleAssetVersionSchema = z.object({
  id: z.int(),
  refKind: z.enum(RULE_ASSET_VERSION_KINDS),
  refId: z.int(),
  version: z.int(),
  publishedBy: z.int().nullable(),
  publishedAt: z.string(),
}).meta({ id: 'RuleAssetVersion' });

export type RuleAssetVersion = z.infer<typeof ruleAssetVersionSchema>;

/** `{id}/rollback/{version}` 路径参数 */
export const ruleVersionParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '资产 ID', example: 1 }),
  version: z.coerce.number().int().positive().meta({ description: '目标版本号', example: 2 }),
});

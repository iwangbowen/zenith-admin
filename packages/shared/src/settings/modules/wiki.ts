import * as z from 'zod';
import { WIKI_SPACE_VISIBILITIES } from '../../wiki/constants';
import { defineSettingsModule } from '../module-def';

/** 知识中心全局设置 */
export const wikiSettingsSchema = z.object({
  requireApproval: z.boolean().default(true)
    .meta({ title: '发布需要审核', description: '关闭时提交即发布' }),
  defaultVisibility: z.enum(WIKI_SPACE_VISIBILITIES).default('public')
    .meta({ title: '新建空间默认可见性' }),
  aiSyncEnabled: z.boolean().default(false)
    .meta({ title: '同步 AI 知识库', description: '发布文档自动同步到 AI 知识库' }),
  aiSyncKbId: z.int().positive().nullable().default(null)
    .meta({ title: '同步目标知识库 ID', description: '留空表示未指定' }),
  commentsEnabled: z.boolean().default(true)
    .meta({ title: '允许评论' }),
  recycleRetentionDays: z.int().min(0).max(3650).default(0)
    .meta({ title: '回收站保留天数', description: '0 表示永久保留' }),
  pendingRemindHours: z.int().min(1).max(720).default(48)
    .meta({ title: '审核积压提醒时限（小时）' }),
}).meta({ id: 'Settings.Wiki' });

export type WikiSettings = z.output<typeof wikiSettingsSchema>;

export const wikiSettingsModule = defineSettingsModule({
  schema: wikiSettingsSchema,
  title: '知识中心',
  description: '发布审核、默认可见性、评论与 AI 同步',
  scope: 'platform',
  feature: 'wiki',
  readPermission: 'wiki:setting:view',
  writePermission: 'wiki:setting:edit',
  page: '/wiki/settings',
  sort: 130,
});

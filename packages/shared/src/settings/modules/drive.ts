import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 企业网盘全局设置（空间配额 / 版本 / 外链 / 内容策略 / 增强处理） */
export const driveSettingsSchema = z.object({
  personalQuotaGb: z.number().min(0).max(1_000_000).default(10)
    .meta({ title: '个人空间默认配额（GB）', description: '0 表示不限；空间显式配额优先' }),
  departmentQuotaGb: z.number().min(0).max(1_000_000).default(100)
    .meta({ title: '部门空间默认配额（GB）', description: '0 表示不限' }),
  teamQuotaGb: z.number().min(0).max(1_000_000).default(50)
    .meta({ title: '协作空间默认配额（GB）', description: '0 表示不限' }),
  departmentSpaceAutoCreate: z.boolean().default(true)
    .meta({ title: '自动创建部门空间', description: '成员首次进入网盘时创建其直属部门的部门空间（部门及子部门成员默认可编辑，负责人为管理者）' }),
  recycleRetentionDays: z.int().min(0).max(3650).default(30)
    .meta({ title: '回收站保留天数', description: '前端提示用；实际清理由「数据保留 → 网盘回收站到期清理」策略执行' }),
  maxVersions: z.int().min(1).max(200).default(20)
    .meta({ title: '文件版本上限', description: '超出自动修剪最旧版本；空间可单独设置' }),
  quotaWarningPercent: z.int().min(50).max(100).default(90)
    .meta({ title: '配额预警阈值（%）', description: '已用比例达到该值时通知空间管理者（每日一次）' }),
  externalShareEnabled: z.boolean().default(true)
    .meta({ title: '允许外链分享', description: '关闭后任何人不能创建网盘外链（已有外链仍可撤销）' }),
  externalShareMaxDays: z.int().min(0).max(3650).default(30)
    .meta({ title: '外链最长有效期（天）', description: '外链必须设置且不超过该天数；0 表示允许永久外链' }),
  externalShareRequirePassword: z.boolean().default(false)
    .meta({ title: '外链强制密码' }),
  blockedExtensions: z.array(z.string().trim().min(1).max(32).regex(/^\.?[A-Za-z0-9]+$/, '扩展名只能包含字母与数字')).max(200)
    .default(() => ['exe', 'bat', 'cmd', 'sh', 'msi', 'dll', 'scr', 'com', 'ps1', 'vbs'])
    .meta({ title: '禁止上传的扩展名', description: '不区分大小写，可带或不带前导点；可执行文件另按内容魔数拦截，不受改名影响' }),
  thumbnailEnabled: z.boolean().default(true)
    .meta({ title: '生成图片缩略图', description: '图片上传后异步生成 webp 缩略图供网格视图展示' }),
  textIndexEnabled: z.boolean().default(true)
    .meta({ title: '文本文件全文索引', description: '文本类文件（≤ 2MB）上传后抽取正文建立索引，搜索可勾选「搜正文」' }),
}).meta({ id: 'Settings.Drive' });

export type DriveSettings = z.output<typeof driveSettingsSchema>;

export const driveSettingsModule = defineSettingsModule({
  schema: driveSettingsSchema,
  title: '企业网盘',
  description: '空间配额、版本保留、外链与内容策略',
  scope: 'platform',
  feature: 'drive',
  readPermission: 'drive:setting:view',
  writePermission: 'drive:setting:edit',
  page: '/drive/admin/settings',
  sort: 120,
});

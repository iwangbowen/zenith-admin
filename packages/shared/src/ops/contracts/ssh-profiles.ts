import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SSH_AUTH_TYPES } from '../constants';
import { createSshProfileSchema, updateSshProfileSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const sshProfileSchema = z.object({
  id: z.int(),
  userId: z.int(),
  name: z.string(),
  host: z.string(),
  port: z.int(),
  username: z.string(),
  authType: z.enum(SSH_AUTH_TYPES),
  hasPassword: z.boolean().meta({ description: '密码仅返回是否已设置，不回传明文' }),
  keyPath: z.string().nullable(),
  hasKeyContent: z.boolean().meta({ description: '私钥内容仅返回是否已设置' }),
  hasKeyPassphrase: z.boolean().meta({ description: '口令仅返回是否已设置' }),
  envVars: z.record(z.string(), z.string()),
  groupName: z.string().nullable().meta({ description: '所属分组名称（null 表示未分组）' }),
  tags: z.array(z.string()),
  orderNum: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SshProfile' });

export type SshProfile = z.infer<typeof sshProfileSchema>;

// ─── 契约（仅当前用户自己的配置） ───────────────────────────────────────────────

export const sshProfileContract = defineContract('/api/ssh-profiles', {
  list: op.get('/', { response: z.array(sshProfileSchema), summary: '我的 SSH 配置列表' }),
  create: op.post('/', { body: createSshProfileSchema, response: sshProfileSchema, summary: '创建 SSH 配置' }),
  detail: op.get('/{id}', { params: idParam, response: sshProfileSchema, summary: '获取 SSH 配置详情' }),
  update: op.put('/{id}', { params: idParam, body: updateSshProfileSchema, response: sshProfileSchema, summary: '更新 SSH 配置' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 SSH 配置' }),
}, { tags: ['SshProfiles'] });

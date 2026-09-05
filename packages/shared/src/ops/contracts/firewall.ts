import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { FIREWALL_DIRECTIONS, FIREWALL_PROTOCOLS, FIREWALL_RULE_TYPES, FIREWALL_TYPES } from '../constants';
import { addFirewallRuleSchema } from '../validation';
import { hostQuery } from './ops-hosts';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const firewallStatusSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(FIREWALL_TYPES),
  version: z.string().nullable(),
  defaultIncoming: z.string().nullable(),
  defaultOutgoing: z.string().nullable(),
}).meta({ id: 'FirewallStatus' });

export type FirewallStatus = z.infer<typeof firewallStatusSchema>;

export const firewallRuleSchema = z.object({
  id: z.string(),
  type: z.enum(FIREWALL_RULE_TYPES),
  protocol: z.enum(FIREWALL_PROTOCOLS),
  port: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(FIREWALL_DIRECTIONS),
  comment: z.string().nullable(),
  raw: z.string().optional().meta({ description: '防火墙原始规则文本' }),
}).meta({ id: 'FirewallRule' });

export type FirewallRule = z.infer<typeof firewallRuleSchema>;

export const firewallRuleListSchema = z.object({
  type: z.enum(FIREWALL_TYPES),
  rules: z.array(firewallRuleSchema),
}).meta({ id: 'FirewallRuleList' });

export type FirewallRuleList = z.infer<typeof firewallRuleListSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const firewallRuleIdParam = z.object({
  id: z.string().meta({ description: '防火墙规则 ID', example: '1' }),
});

export const firewallContract = defineContract('/api/firewall', {
  status: op.get('/', { query: hostQuery, response: firewallStatusSchema, summary: '获取防火墙状态' }),
  rules: op.get('/rules', { query: hostQuery, response: firewallRuleListSchema, summary: '获取防火墙规则列表' }),
  addRule: op.post('/rules', { query: hostQuery, body: addFirewallRuleSchema, summary: '添加防火墙规则' }),
  removeRule: op.delete('/rules/{id}', { params: firewallRuleIdParam, query: hostQuery, summary: '删除防火墙规则' }),
  enable: op.post('/enable', { query: hostQuery, summary: '启用防火墙' }),
  disable: op.post('/disable', { query: hostQuery, summary: '禁用防火墙' }),
}, { tags: ['Firewall'] });

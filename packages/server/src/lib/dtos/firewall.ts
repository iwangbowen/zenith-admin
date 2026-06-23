import { z } from '@hono/zod-openapi';

export const FirewallStatusDTO = z.object({
  enabled: z.boolean(),
  type: z.enum(['ufw', 'firewalld', 'iptables', 'unknown']),
  version: z.string().nullable(),
  defaultIncoming: z.string().nullable(),
  defaultOutgoing: z.string().nullable(),
}).openapi('FirewallStatus');

export const FirewallRuleDTO = z.object({
  id: z.string(),
  type: z.enum(['allow', 'deny', 'reject']),
  protocol: z.enum(['tcp', 'udp', 'any']),
  port: z.string(),
  from: z.string(),
  to: z.string(),
  direction: z.enum(['in', 'out', 'any']),
  comment: z.string().nullable(),
  raw: z.string().optional(),
}).openapi('FirewallRule');

export const FirewallRuleListDTO = z.object({
  type: z.enum(['ufw', 'firewalld', 'iptables', 'unknown']),
  rules: z.array(FirewallRuleDTO),
}).openapi('FirewallRuleList');

export const AddFirewallRuleDTO = z.object({
  type: z.enum(['allow', 'deny', 'reject']),
  protocol: z.enum(['tcp', 'udp', 'any']),
  port: z.string().max(20),
  from: z.string().max(100).default('any'),
  to: z.string().max(100).default('any'),
  direction: z.enum(['in', 'out', 'any']).default('in'),
  comment: z.string().max(200).optional(),
}).openapi('AddFirewallRule');

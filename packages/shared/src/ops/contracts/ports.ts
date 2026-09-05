import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { hostQuery } from './ops-hosts';
import { pidParam } from './processes';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const portEntrySchema = z.object({
  protocol: z.string(),
  localAddress: z.string(),
  localPort: z.int(),
  state: z.string(),
  pid: z.int().nullable(),
  processName: z.string().nullable(),
  serviceName: z.string().nullable().meta({ description: '按端口号推断的常见服务名' }),
}).meta({ id: 'PortEntry' });

export type PortEntry = z.infer<typeof portEntrySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const portContract = defineContract('/api/ports', {
  list: op.get('/', { query: hostQuery, response: z.array(portEntrySchema), summary: '获取监听端口列表' }),
  kill: op.delete('/{pid}', { params: pidParam, query: hostQuery, summary: '结束占用端口的进程' }),
}, { tags: ['Ports'] });

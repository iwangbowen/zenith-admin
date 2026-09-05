import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { killProcessSchema, setProcessPrioritySchema } from '../validation';
import { hostQuery } from './ops-hosts';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const processNetConnSchema = z.object({
  localAddr: z.string(),
  localPort: z.int(),
  remoteAddr: z.string(),
  remotePort: z.int(),
  state: z.string(),
  protocol: z.string().meta({ description: 'tcp | udp' }),
}).meta({ id: 'ProcessNetConn' });

export type ProcessNetConn = z.infer<typeof processNetConnSchema>;

export const processInfoSchema = z.object({
  pid: z.int(),
  ppid: z.int(),
  name: z.string(),
  status: z.string().meta({ description: 'running | sleeping | disk-sleep | stopped | zombie | idle | unknown' }),
  cpu: z.number().meta({ description: 'CPU 占用百分比（Linux / macOS 为瞬时值，Windows 为累计 CPU 秒数）' }),
  memory: z.int().meta({ description: 'RSS 内存字节数' }),
  memoryPercent: z.number(),
  startTime: z.string().nullable(),
  command: z.string().meta({ description: '完整命令行或进程名' }),
  user: z.string(),
  threads: z.int(),
  nice: z.int().nullable().meta({ description: 'Nice 值 -20~19（Linux / macOS）；Windows 为 null' }),
  priorityClass: z.string().nullable().meta({ description: 'Windows 优先级类；Unix 为 null' }),
  ports: z.string().nullable().meta({ description: '监听端口（逗号分隔）' }),
  connections: z.array(processNetConnSchema).nullable().meta({ description: '连接明细（仅详情返回）' }),
  cwd: z.string().nullable().optional().meta({ description: '工作目录（仅 Linux 详情，无权限为 null）' }),
  env: z.record(z.string(), z.string()).nullable().optional().meta({ description: '环境变量（仅 Linux 详情，无权限为 null）' }),
}).meta({ id: 'ProcessInfo' });

export type ProcessInfo = z.infer<typeof processInfoSchema>;

export const processListResponseSchema = z.object({
  platform: z.string().meta({ description: 'linux | darwin | win32' }),
  processes: z.array(processInfoSchema),
  total: z.int(),
  timestamp: z.string(),
}).meta({ id: 'ProcessListResponse' });

export type ProcessListResponse = z.infer<typeof processListResponseSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const pidParam = z.object({
  pid: z.coerce.number().int().positive().meta({ description: '进程 ID', example: 1234 }),
});

export const processContract = defineContract('/api/processes', {
  list: op.get('/', { query: hostQuery, response: processListResponseSchema, summary: '获取进程列表' }),
  stream: op.get('/stream', { query: hostQuery, kind: 'sse', response: z.string(), summary: '进程列表 SSE 实时推送（每 3 秒一帧）' }),
  detail: op.get('/{pid}', { params: pidParam, query: hostQuery, response: processInfoSchema, summary: '获取进程详情' }),
  kill: op.delete('/{pid}', { params: pidParam, query: hostQuery, body: killProcessSchema, summary: '结束进程' }),
  setPriority: op.put('/{pid}/priority', { params: pidParam, query: hostQuery, body: setProcessPrioritySchema, summary: '调整进程优先级' }),
}, { tags: ['进程管理'] });

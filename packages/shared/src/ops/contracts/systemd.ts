import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { SYSTEMD_ACTIONS } from '../constants';
import { hostQuery } from './ops-hosts';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const systemdServiceSchema = z.object({
  name: z.string(),
  description: z.string(),
  loadState: z.string(),
  activeState: z.string(),
  subState: z.string(),
}).meta({ id: 'SystemdService' });

export type SystemdService = z.infer<typeof systemdServiceSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const systemdServiceNameParam = z.object({
  name: z.string().meta({ description: 'systemd 服务名（不含 .service 后缀亦可）', example: 'nginx' }),
});

export const systemdControlParam = systemdServiceNameParam.extend({
  action: z.enum(SYSTEMD_ACTIONS),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const systemdContract = defineContract('/api/systemd', {
  logsStream: op.get('/{name}/logs/stream', { params: systemdServiceNameParam, query: hostQuery, kind: 'file', summary: '服务日志实时跟踪（journalctl -f 逐行流式输出）' }),
  check: op.get('/check', { query: hostQuery, response: z.object({ available: z.boolean() }), summary: '检查 systemd 可用性' }),
  list: op.get('/', { query: hostQuery, response: z.array(systemdServiceSchema), summary: '列出 systemd 服务' }),
  control: op.post('/{name}/{action}', { params: systemdControlParam, query: hostQuery, summary: '控制服务（启停 / 重启 / 开机自启 / 屏蔽）' }),
  detail: op.get('/{name}/detail', { params: systemdServiceNameParam, query: hostQuery, response: z.record(z.string(), z.string()).meta({ description: 'systemctl show 的键值对' }), summary: '获取服务详情' }),
  logs: op.get('/{name}/logs', { params: systemdServiceNameParam, query: hostQuery, response: z.object({ logs: z.string() }), summary: '获取服务近期日志' }),
}, { tags: ['Systemd'] });

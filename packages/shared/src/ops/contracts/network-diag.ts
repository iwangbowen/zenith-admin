import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { DNS_RECORD_TYPES, NET_DIAG_STREAM_TYPES } from '../constants';
import { networkHttpProbeSchema, networkPortCheckSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const networkPortCheckResultSchema = z.object({
  open: z.boolean(),
  latencyMs: z.number(),
}).meta({ id: 'NetworkPortCheckResult' });

export type NetworkPortCheckResult = z.infer<typeof networkPortCheckResultSchema>;

export const networkDnsResultSchema = z.object({
  type: z.string(),
  records: z.array(z.string()),
}).meta({ id: 'NetworkDnsResult' });

export type NetworkDnsResult = z.infer<typeof networkDnsResultSchema>;

export const networkHttpProbeResultSchema = z.object({
  ok: z.boolean(),
  status: z.number(),
  statusText: z.string(),
  latencyMs: z.number(),
  server: z.string().nullable(),
  contentType: z.string().nullable(),
  contentLength: z.string().nullable(),
  redirectLocation: z.string().nullable(),
  error: z.string().nullable(),
}).meta({ id: 'NetworkHttpProbeResult' });

export type NetworkHttpProbeResult = z.infer<typeof networkHttpProbeResultSchema>;

export const networkInterfaceSchema = z.object({
  name: z.string(),
  address: z.string(),
  netmask: z.string(),
  family: z.string(),
  mac: z.string(),
  internal: z.boolean(),
  cidr: z.string().nullable(),
}).meta({ id: 'NetworkInterface' });

export type NetworkInterface = z.infer<typeof networkInterfaceSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const networkDiagStreamQuery = z.object({
  type: z.enum(NET_DIAG_STREAM_TYPES),
  host: z.string().min(1).meta({ description: '目标主机名或 IP' }),
});

export const networkHostQuery = z.object({
  host: z.string().min(1).max(253),
});

export const networkDnsQuery = z.object({
  host: z.string().min(1).max(253),
  type: z.enum(DNS_RECORD_TYPES).default('A'),
});

export const networkReverseQuery = z.object({
  ip: z.string().min(1).max(45),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const networkDiagContract = defineContract('/api/network-diag', {
  stream: op.get('/stream', { query: networkDiagStreamQuery, kind: 'file', summary: 'ping / traceroute 逐行流式输出' }),
  nslookup: op.get('/nslookup', { query: networkHostQuery, response: z.object({ output: z.string() }), summary: 'DNS 查询' }),
  portCheck: op.post('/port-check', { body: networkPortCheckSchema, response: networkPortCheckResultSchema, summary: 'TCP 端口检测' }),
  dns: op.get('/dns', { query: networkDnsQuery, response: networkDnsResultSchema, summary: 'DNS 记录解析（A/AAAA/MX/TXT/NS/CNAME/SOA）' }),
  reverse: op.get('/reverse', { query: networkReverseQuery, response: z.object({ hostnames: z.array(z.string()) }), summary: '反向 DNS（PTR）' }),
  httpProbe: op.post('/http-probe', { body: networkHttpProbeSchema, response: networkHttpProbeResultSchema, summary: 'HTTP(S) 探测' }),
  interfaces: op.get('/interfaces', { response: z.array(networkInterfaceSchema), summary: '本机网卡信息' }),
}, { tags: ['NetworkDiag'] });

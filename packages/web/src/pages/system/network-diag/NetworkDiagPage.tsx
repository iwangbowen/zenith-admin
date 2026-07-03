import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button, Input, Select, InputNumber, Tag, Typography, Tabs, TabPane } from '@douyinfe/semi-ui';
import { Play, Square, Wifi, Search } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import {
  useDnsLookup,
  useHttpProbe,
  useNetworkInterfaces,
  useNslookup,
  usePortCheck,
  useReverseLookup,
  type DnsType,
} from '@/hooks/queries/network-diag';

const TOOL_OPTIONS = [
  { value: 'ping', label: 'Ping', desc: '检测主机连通性和延迟' },
  { value: 'traceroute', label: 'Traceroute', desc: '追踪数据包路由路径' },
  { value: 'nslookup', label: 'NSLookup', desc: 'DNS 正向/反向解析' },
  { value: 'dns', label: 'DNS 记录', desc: '查询 A/AAAA/MX/TXT/NS/CNAME/SOA 记录' },
  { value: 'reverse', label: '反向 DNS', desc: 'IP → 主机名（PTR）' },
  { value: 'http', label: 'HTTP 探测', desc: '检测 URL 状态码、耗时与响应头' },
  { value: 'port-check', label: '端口检测', desc: '检测 TCP 端口是否开放' },
  { value: 'interfaces', label: '网卡信息', desc: '查看本机网络接口' },
] as const;

type ToolType = (typeof TOOL_OPTIONS)[number]['value'];

const STREAMING_TOOLS = new Set<ToolType>(['ping', 'traceroute']);
/** 无需主机输入的工具 */
const NO_HOST_TOOLS = new Set<ToolType>(['interfaces']);

// ─── Traceroute 解析 + 可视化 ────────────────────────────────────────────────

interface HopInfo {
  hop: number; host: string; ip: string | null;
  rtts: number[]; timeout: boolean; avgRtt: number | null;
}

function parseTraceroute(text: string): HopInfo[] {
  const hops: HopInfo[] = [];
  for (const line of text.split('\n')) {
    // Linux: " 1  host (1.2.3.4)  X ms  Y ms  Z ms"
    const lm = line.match(/^\s*(\d+)\s+(.+?)\s+\(([^)]+)\)\s+(.+)$/);
    if (lm) {
      const rtts = [...lm[4].matchAll(/(\d+(?:\.\d+)?)\s+ms/g)].map((m) => Number.parseFloat(m[1]));
      hops.push({
        hop: Number.parseInt(lm[1], 10), host: lm[2].trim(), ip: lm[3],
        rtts, timeout: rtts.length === 0,
        avgRtt: rtts.length > 0 ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null,
      });
      continue;
    }
    // Timeout: " 3  * * *"
    const tm = line.match(/^\s*(\d+)\s+\*\s+\*\s+\*/);
    if (tm) {
      hops.push({ hop: Number.parseInt(tm[1], 10), host: '*', ip: null, rtts: [], timeout: true, avgRtt: null });
      continue;
    }
    // Windows tracert: "  1     1 ms  ..."
    const wm = line.match(/^\s*(\d+)\s+.+$/);
    if (wm) {
      const winRtts = [...line.matchAll(/(\d+)\s+ms/g)].map((m) => Number.parseInt(m[1], 10));
      const winHost = line.replace(/^\s*\d+\s+([\d\s]+ms\s*){0,3}/, '').replace(/[\r\n]/g, '').trim();
      const isTimeout = line.includes('*') || winRtts.length === 0;
      hops.push({
        hop: Number.parseInt(wm[1], 10), host: winHost || '*', ip: null,
        rtts: winRtts, timeout: isTimeout,
        avgRtt: winRtts.length > 0 ? winRtts.reduce((a, b) => a + b, 0) / winRtts.length : null,
      });
    }
  }
  return hops;
}

function rttColor(ms: number): string {
  if (ms < 20) return '#27ae60';
  if (ms < 80) return '#f39c12';
  return '#e74c3c';
}

function TracerouteViz({ hops }: { hops: HopInfo[] }) {
  const maxRtt = Math.max(...hops.filter((h) => h.avgRtt !== null).map((h) => h.avgRtt ?? 0), 1);
  return (
    <div style={{ overflowX: 'auto', padding: '4px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
            {['跳', '主机', 'IP', 'RTT 均值', '延迟可视化'].map((h) => (
              <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--semi-color-text-1)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hops.map((hop) => (
            <tr key={hop.hop} style={{ borderBottom: '1px solid var(--semi-color-fill-1)' }}>
              <td style={{ padding: '4px 8px', width: 40, color: 'var(--semi-color-text-2)' }}>{hop.hop}</td>
              <td style={{ padding: '4px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hop.timeout ? <span style={{ color: 'var(--semi-color-text-3)' }}>超时</span> : (hop.host !== hop.ip ? hop.host : '—')}
              </td>
              <td style={{ padding: '4px 8px', color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>{hop.ip ?? hop.host}</td>
              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                {hop.avgRtt !== null
                  ? <Tag size="small" color={hop.avgRtt < 20 ? 'green' : hop.avgRtt < 80 ? 'orange' : 'red'}>{hop.avgRtt.toFixed(1)} ms</Tag>
                  : <span style={{ color: 'var(--semi-color-text-3)' }}>—</span>
                }
              </td>
              <td style={{ padding: '4px 8px', minWidth: 150 }}>
                {hop.avgRtt !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      height: 12, borderRadius: 3,
                      width: `${Math.max((hop.avgRtt / maxRtt) * 140, 4)}px`,
                      background: rttColor(hop.avgRtt),
                      transition: 'width 0.4s ease',
                    }} />
                    {hop.rtts.length > 1 && (
                      <span style={{ color: 'var(--semi-color-text-3)', fontSize: 11 }}>
                        {hop.rtts.map((r) => `${r.toFixed(1)}`).join(' / ')} ms
                      </span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hops.length === 0 && (
        <Typography.Text type="tertiary" style={{ padding: '12px 8px', display: 'block', fontStyle: 'italic' }}>
          等待 traceroute 输出...
        </Typography.Text>
      )}
    </div>
  );
}

async function fetchStream(
  url: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const base = config.apiBaseUrl || '';
  const resp = await fetch(`${base}${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!resp.ok) { onChunk(`\n❌ HTTP ${resp.status}\n`); return; }
  const reader = resp.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

export default function NetworkDiagPage() {
  const [tool, setTool] = useState<ToolType>('ping');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(80);
  const [dnsType, setDnsType] = useState<DnsType>('A');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const nslookupMutation = useNslookup();
  const dnsLookupMutation = useDnsLookup();
  const reverseLookupMutation = useReverseLookup();
  const httpProbeMutation = useHttpProbe();
  const interfacesMutation = useNetworkInterfaces();
  const portCheckMutation = usePortCheck();

  const hops = useMemo(() => (tool === 'traceroute' ? parseTraceroute(output) : []), [output, tool]);

  // 输出更新时自动滚到底部
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [output]);

  const handleRun = useCallback(async () => {
    if (!host.trim() && !NO_HOST_TOOLS.has(tool)) return;
    setOutput('');
    setRunning(true);

    if (STREAMING_TOOLS.has(tool)) {
      const abort = new AbortController();
      abortRef.current = abort;
      const params = new URLSearchParams({ type: tool, host: host.trim() });
      try {
        await fetchStream(
          `/api/network-diag/stream?${params.toString()}`,
          (text) => setOutput((prev) => prev + text),
          abort.signal,
        );
      } catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError')) {
          setOutput((prev) => `${prev}\n❌ 错误: ${(e as Error).message}\n`);
        }
      }
      abortRef.current = null;
    } else if (tool === 'nslookup') {
      const res = await nslookupMutation.mutateAsync(host.trim());
      setOutput(res.output);
    } else if (tool === 'dns') {
      const res = await dnsLookupMutation.mutateAsync({ host: host.trim(), type: dnsType });
      const { records } = res;
      setOutput(records.length
        ? `${dnsType} 记录（${host.trim()}）:\n\n${records.map((r) => `  ${r}`).join('\n')}`
        : `未找到 ${dnsType} 记录`);
    } else if (tool === 'reverse') {
      const res = await reverseLookupMutation.mutateAsync(host.trim());
      setOutput(res.hostnames.length
        ? `${host.trim()} 反查结果:\n\n${res.hostnames.map((h) => `  ${h}`).join('\n')}`
        : '未找到 PTR 记录');
    } else if (tool === 'http') {
      const d = await httpProbeMutation.mutateAsync(host.trim());
      if (d.error) {
        setOutput(`❌ 探测失败：${d.error}（耗时 ${d.latencyMs} ms）`);
      } else {
        const lines = [
          `${d.ok ? '✅' : '⚠️'} ${host.trim()}`,
          ``,
          `状态码      : ${d.status} ${d.statusText}`,
          `响应耗时    : ${d.latencyMs} ms`,
          `Server      : ${d.server ?? '—'}`,
          `Content-Type: ${d.contentType ?? '—'}`,
          `内容长度    : ${d.contentLength ?? '—'}`,
          ...(d.redirectLocation ? [`重定向到    : ${d.redirectLocation}`] : []),
        ];
        setOutput(lines.join('\n'));
      }
    } else if (tool === 'interfaces') {
      const res = await interfacesMutation.mutateAsync();
      const rows = res.map((i) =>
        `${i.name.padEnd(12)} ${i.family.padEnd(6)} ${i.address.padEnd(40)} ${i.internal ? '(internal)' : ''} ${i.mac && i.mac !== '00:00:00:00:00:00' ? i.mac : ''}`.trimEnd(),
      );
      setOutput(`本机网卡（${res.length} 条）:\n\n${rows.join('\n')}`);
    } else if (tool === 'port-check') {
      const { open, latencyMs } = await portCheckMutation.mutateAsync({ host: host.trim(), port });
      setOutput(open
        ? `✅ ${host.trim()}:${port} 端口开放（延迟 ${latencyMs} ms）`
        : `❌ ${host.trim()}:${port} 端口不可达（超时 ${latencyMs} ms）`,
      );
    }
    setRunning(false);
  }, [tool, host, port, dnsType, nslookupMutation, dnsLookupMutation, reverseLookupMutation, httpProbeMutation, interfacesMutation, portCheckMutation]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setOutput((prev) => `${prev}\n\n⬛ 已手动停止\n`);
  }, []);

  const selectedTool = TOOL_OPTIONS.find((t) => t.value === tool)!;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 12 }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wifi size={18} style={{ color: 'var(--semi-color-primary)' }} />
        <Typography.Title heading={6} style={{ margin: 0 }}>网络诊断</Typography.Title>
      </div>

      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            诊断工具
          </Typography.Text>
          <Select
            value={tool}
            onChange={(v) => setTool(v as ToolType)}
            style={{ width: 140 }}
            optionList={TOOL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {tool === 'http' ? 'URL' : tool === 'reverse' ? 'IP 地址' : tool === 'interfaces' ? '（无需输入）' : '主机名 / IP'}
          </Typography.Text>
          <Input
            placeholder={tool === 'http' ? 'https://example.com' : tool === 'reverse' ? '如 8.8.8.8' : tool === 'interfaces' ? '点击运行查看本机网卡' : '如 google.com 或 8.8.8.8'}
            value={host}
            onChange={setHost}
            prefix={<Search size={13} />}
            showClear
            disabled={tool === 'interfaces'}
            onEnterPress={() => !running && void handleRun()}
          />
        </div>
        {tool === 'dns' && (
          <div>
            <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>记录类型</Typography.Text>
            <Select value={dnsType} onChange={(v) => setDnsType(v as DnsType)} style={{ width: 100 }}
              optionList={['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'].map((t) => ({ value: t, label: t }))} />
          </div>
        )}
        {tool === 'port-check' && (
          <div>
            <Typography.Text size="small" type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              端口
            </Typography.Text>
            <InputNumber min={1} max={65535} value={port} onChange={(v) => setPort(Number(v))} style={{ width: 100 }} />
          </div>
        )}
        {!running ? (
          <Button
            type="primary"
            icon={<Play size={14} />}
            disabled={!host.trim() && !NO_HOST_TOOLS.has(tool)}
            onClick={() => void handleRun()}
          >
            运行
          </Button>
        ) : (
          <Button type="danger" icon={<Square size={14} />} onClick={handleStop}>停止</Button>
        )}
      </div>

      {/* 工具说明 */}
      <div>
        <Tag color="blue" size="small">{selectedTool.label}</Tag>
        <Typography.Text type="tertiary" size="small" style={{ marginLeft: 8 }}>{selectedTool.desc}</Typography.Text>
      </div>

      {/* 输出区 */}
      <div style={{ flex: 1, minHeight: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--semi-color-border)' }}>
        {tool === 'traceroute'
          ? (
            <Tabs type="line" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              tabBarExtraContent={running ? <Tag color="green" size="small" style={{ marginRight: 8 }}>● 运行中</Tag> : undefined}>
              <TabPane tab="可视化" itemKey="viz" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
                <div style={{ padding: 12, height: '100%', overflow: 'auto', background: 'var(--semi-color-bg-1)' }}>
                  <TracerouteViz hops={hops} />
                </div>
              </TabPane>
              <TabPane tab="原始输出" itemKey="raw" style={{ flex: 1, minHeight: 0 }}>
                <pre ref={preRef} style={{
                  margin: 0, padding: 12, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--semi-color-bg-1)',
                  height: '100%', overflow: 'auto', color: 'var(--semi-color-text-0)',
                }}>
                  {output || <Typography.Text type="tertiary" style={{ fontStyle: 'italic' }}>等待运行...</Typography.Text>}
                </pre>
              </TabPane>
            </Tabs>
          )
          : (
            <>
              <div style={{ padding: '4px 12px', background: 'var(--semi-color-fill-1)', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography.Text size="small" type="secondary">输出</Typography.Text>
                {running && <Tag color="green" size="small">● 运行中</Tag>}
              </div>
              <pre ref={preRef} style={{
                margin: 0, padding: 12, fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--semi-color-bg-1)',
                height: 'calc(100% - 32px)', overflow: 'auto', color: 'var(--semi-color-text-0)',
              }}>
                {output || <Typography.Text type="tertiary" style={{ fontStyle: 'italic' }}>等待运行...</Typography.Text>}
              </pre>
            </>
          )
        }
      </div>
    </div>
  );
}

/**
 * 工作流域出站 HTTP 的统一出口。
 *
 * 数据源 / 连接器 / 事件订阅 / 自动化 Webhook / 触发器 / 外部派发 / 补偿动作 / 节点监听的目标地址
 * 全部由租户侧配置（甚至由流程表单值渲染），必须一律开启 SSRF 防护：
 * - 保存时 `assertSafeWorkflowUrl()` 拒绝 loopback / 私网 / 链路本地 / 云元数据地址与非 http(s) 协议；
 * - 请求时 `workflowHttp*()` 走 http-client 的 DNS 固定分发器（解析结果逐一校验、禁止重定向），
 *   即使保存后 DNS 记录被改到内网也拦得住。
 * 需要访问内网服务时由运维在 WORKFLOW_OUTBOUND_ALLOWED_HOSTS 明确放行。
 */
import { config } from '../config';
import { httpRequest, type HttpRequestOptions, type HttpResponse } from './http-client';
import { assertSafeOutboundUrl } from './outbound-url';
import { currentWorkflowJobContext } from './workflow-jobs/execution-context';

type WorkflowHttpOptions = Omit<HttpRequestOptions, 'ssrfProtection' | 'ssrfAllowlist' | 'proxy'>;

export function workflowOutboundAllowlist(): string[] {
  return config.workflow.outboundAllowedHosts;
}

/** 保存配置时校验出站地址（协议 / 凭据 / 解析地址），不合规抛 400 */
export async function assertSafeWorkflowUrl(url: string): Promise<URL> {
  return assertSafeOutboundUrl(url, workflowOutboundAllowlist());
}

export async function workflowHttp(url: string, opts: WorkflowHttpOptions = {}): Promise<HttpResponse> {
  const context = currentWorkflowJobContext();
  if (!context) return httpRequest(url, { ...opts, ssrfProtection: true, ssrfAllowlist: workflowOutboundAllowlist() });
  context.signal.throwIfAborted();
  const signal = opts.signal ? AbortSignal.any([opts.signal, context.signal]) : context.signal;
  const headers = new Headers(opts.headers);
  headers.set('X-Idempotency-Key', context.operationKey);
  const { markWorkflowExternalEffect } = await import('./workflow-jobs/external-effects');
  await markWorkflowExternalEffect(opts.method ?? 'GET', url);
  return httpRequest(url, {
    ...opts, headers, signal, retries: 0,
    ssrfProtection: true, ssrfAllowlist: workflowOutboundAllowlist(),
  });
}

export function workflowHttpGet(url: string, opts: Omit<WorkflowHttpOptions, 'method' | 'body'> = {}): Promise<HttpResponse> {
  return workflowHttp(url, { ...opts, method: 'GET' });
}

export function workflowHttpPost(url: string, body: HttpRequestOptions['body'], opts: Omit<WorkflowHttpOptions, 'method' | 'body'> = {}): Promise<HttpResponse> {
  return workflowHttp(url, { ...opts, method: 'POST', body });
}

/**
 * 连接器 URL 拼装：`path` 只能是相对路径或与 baseUrl 同源的绝对地址。
 * 事件订阅 / 触发器作者可以引用别人的连接器，若允许任意绝对地址替换 baseUrl，
 * 连接器上解密出的凭据（Bearer / Basic / API Key）就会被带到攻击者主机。
 */
export function buildConnectorUrl(baseUrl: string, path: string | undefined, query: Record<string, string>): string {
  let url = (baseUrl ?? '').trim();
  if (path) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
      const base = parseUrlOrNull(url);
      const target = parseUrlOrNull(path.startsWith('//') ? `${base?.protocol ?? 'https:'}${path}` : path);
      if (!base || !target || target.origin !== base.origin) {
        throw new Error('连接器调用路径只能是相对路径或与连接器基地址同源的地址');
      }
      url = target.toString();
    } else {
      url = `${url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }
  }
  const qs = Object.keys(query).length ? new URLSearchParams(query).toString() : '';
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  return url;
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * 出站 URL 模板渲染：每个占位符的值都做百分号编码后再拼进 URL。
 * 表单值（由流程发起人填写）只能落成路径 / 查询参数里的一个「值」，不能带入 `/`、`?`、`#`、`@`
 * 去改写路径层级、追加参数或伪造 userinfo；主机与协议由模板作者决定。
 */
export function renderUrlTemplate(template: string, resolve: (key: string) => unknown): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const v = resolve(key);
    if (v === undefined || v === null) return '';
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return encodeURIComponent(text);
  });
}

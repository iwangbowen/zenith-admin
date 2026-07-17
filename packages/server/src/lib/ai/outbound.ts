import { config } from '../../config';

/**
 * AI 出站请求（LLM / embeddings 网关）的 SSRF 防护选项。
 * baseUrl 可由管理员 / 用户配置，必须启用出站校验；
 * 内网 LLM 网关（Ollama 等）通过 AI_OUTBOUND_PRIVATE_ALLOWLIST 放行（默认含本机）。
 */
export const AI_SSRF_OPTIONS = {
  ssrfProtection: true as const,
  ssrfAllowlist: config.ai.outboundPrivateAllowlist,
};

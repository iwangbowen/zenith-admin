import { getConfigValue } from '../system-config';
import { getRawDefaultProviderConfig } from '../../services/ai/ai-providers.service';
import { httpRequest } from '../http-client';
import { AI_SSRF_OPTIONS } from './outbound';

const IMAGE_TIMEOUT_MS = 60_000;

/**
 * 通过系统默认服务商的 OpenAI 兼容 /images/generations 接口生成图片。
 * 依赖系统配置 ai_image_model（留空 = 功能关闭，generate_image 工具不注册）。
 * 返回图片 URL（供应商直链或 base64 data URL）。
 */
export async function generateImageViaProvider(prompt: string): Promise<string> {
  const model = (await getConfigValue('ai_image_model', '')).trim();
  if (!model) throw new Error('管理员未配置图片生成模型（ai_image_model）');
  if (!prompt.trim()) throw new Error('图片描述不能为空');

  const cfg = await getRawDefaultProviderConfig();
  if (!cfg || cfg.provider !== 'openai_compatible') {
    throw new Error('图片生成需要 OpenAI 兼容的系统默认服务商配置');
  }

  const res = await httpRequest(`${cfg.baseUrl.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model, prompt: prompt.slice(0, 2000), n: 1, size: '1024x1024' }),
    timeout: IMAGE_TIMEOUT_MS,
    ...AI_SSRF_OPTIONS,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`图片生成失败：HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { data?: Array<{ url?: string; b64_json?: string }> };
  const first = data.data?.[0];
  if (first?.url) return first.url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  throw new Error('图片生成响应中没有图片数据');
}

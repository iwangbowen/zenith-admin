/**
 * Webhook 通知（报表预警 / 订阅推送共用）。
 * 按机器人域名自动适配 payload：企微群机器人 / 钉钉自定义机器人 / 通用 JSON 端点。
 * 出站走 httpRequest（含 SSRF 防护 / 熔断 / 超时）。
 */
import { httpRequest } from './http-client';

function buildPayload(hostname: string, title: string, content: string): Record<string, unknown> {
  if (hostname.endsWith('qyapi.weixin.qq.com')) {
    return { msgtype: 'markdown', markdown: { content: `**${title}**\n${content}` } };
  }
  if (hostname.endsWith('oapi.dingtalk.com')) {
    return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${content.replace(/\n/g, '\n\n')}` } };
  }
  return { title, content };
}

/** 发送 Webhook 通知；失败抛 Error（调用方按通道容错记日志） */
export async function sendWebhookNotification(url: string, title: string, content: string): Promise<void> {
  const hostname = new URL(url).hostname;
  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: buildPayload(hostname, title, content),
    timeout: 10_000,
  });
  if (!res.ok) throw new Error(`Webhook 返回状态 ${res.status}`);
}

/**
 * 短信发送服务商抽象层。
 *
 * 支持服务商：
 *   - aliyun（阿里云短信，使用 @alicloud/dysmsapi20170525）
 *   - tencent（腾讯云短信，使用 tencentcloud-sdk-nodejs-sms）
 *
 * 不在此文件中查询数据库 / 写日志。日志由 sms-send-logs.service 负责。
 */
import Dysmsapi20170525, * as $Dysmsapi from '@alicloud/dysmsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import * as tencentcloud from 'tencentcloud-sdk-nodejs-sms';

import type { SmsConfigRow, SmsTemplateRow } from '../db/schema';

export interface SendSmsParams {
  config: SmsConfigRow;
  template: SmsTemplateRow;
  phone: string;
  variables: Record<string, string>;
  /** 渲染后的最终短信内容（用于落库 / 日志）。 */
  renderedContent: string;
}

export interface SendSmsResult {
  success: boolean;
  bizId: string | null;
  errorMsg: string | null;
}

/** 阿里云短信发送 */
async function sendAliyunSms(p: SendSmsParams): Promise<SendSmsResult> {
  const client = new Dysmsapi20170525(
    new $OpenApi.Config({
      accessKeyId: p.config.accessKeyId,
      accessKeySecret: p.config.accessKeySecret,
      endpoint: 'dysmsapi.aliyuncs.com',
      regionId: p.config.region || 'cn-hangzhou',
    }),
  );
  const req = new $Dysmsapi.SendSmsRequest({
    phoneNumbers: p.phone,
    signName: p.template.signName || p.config.signName,
    templateCode: p.template.templateCode,
    templateParam: JSON.stringify(p.variables ?? {}),
  });
  try {
    const res = await client.sendSms(req);
    const body = res?.body;
    if (body?.code === 'OK') {
      return { success: true, bizId: body.bizId ?? null, errorMsg: null };
    }
    return { success: false, bizId: body?.bizId ?? null, errorMsg: body?.message ?? '阿里云短信返回错误' };
  } catch (err) {
    return { success: false, bizId: null, errorMsg: err instanceof Error ? err.message : String(err) };
  }
}

/** 腾讯云短信发送 */
async function sendTencentSms(p: SendSmsParams): Promise<SendSmsResult> {
  const SmsClient = tencentcloud.sms.v20210111.Client;
  const client = new SmsClient({
    credential: {
      secretId: p.config.accessKeyId,
      secretKey: p.config.accessKeySecret,
    },
    region: p.config.region || 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
  });
  // 腾讯云 TemplateParamSet 是按变量顺序的数组
  const params = {
    PhoneNumberSet: [p.phone.startsWith('+') ? p.phone : `+86${p.phone}`],
    SmsSdkAppId: p.config.accessKeyId.split(':')[1] || p.config.accessKeyId, // 容错：允许在 accessKeyId 内嵌 SdkAppId
    SignName: p.template.signName || p.config.signName,
    TemplateId: p.template.templateCode,
    TemplateParamSet: Object.values(p.variables ?? {}),
  };
  try {
    const res = await client.SendSms(params);
    const item = res?.SendStatusSet?.[0];
    if (item?.Code === 'Ok') {
      return { success: true, bizId: item.SerialNo ?? null, errorMsg: null };
    }
    return { success: false, bizId: item?.SerialNo ?? null, errorMsg: item?.Message ?? '腾讯云短信返回错误' };
  } catch (err) {
    return { success: false, bizId: null, errorMsg: err instanceof Error ? err.message : String(err) };
  }
}

/** 统一入口：根据 config.provider 路由到对应 SDK */
export async function sendSmsByProvider(p: SendSmsParams): Promise<SendSmsResult> {
  if (p.config.provider === 'aliyun') return sendAliyunSms(p);
  if (p.config.provider === 'tencent') return sendTencentSms(p);
  return { success: false, bizId: null, errorMsg: `不支持的短信服务商: ${p.config.provider as string}` };
}

/** 简单的 {{var}} 占位符替换 */
export function renderTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => variables[key] ?? '');
}

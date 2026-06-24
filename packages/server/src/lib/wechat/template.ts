import { wechatApiGet, wechatApiPost } from './api';
import type { MpCredential } from './api';

export interface WechatTemplate {
  template_id: string;
  title: string;
  content: string;
  example: string;
  primary_industry?: string;
  deputy_industry?: string;
}

interface GetAllResponse {
  errcode?: number;
  errmsg?: string;
  template_list?: WechatTemplate[];
}

/** 获取已添加至账号下的所有模板 */
export async function getAllPrivateTemplates(account: MpCredential): Promise<WechatTemplate[]> {
  const data = await wechatApiGet<GetAllResponse>(account, '/cgi-bin/template/get_all_private_template');
  return data.template_list ?? [];
}

interface SendResponse {
  errcode?: number;
  errmsg?: string;
  msgid?: number;
}

/** 发送模板消息，返回 msgid */
export async function sendTemplateMessage(
  account: MpCredential,
  params: { openid: string; templateId: string; url?: string; data: Record<string, { value: string; color?: string }> },
): Promise<string> {
  const data = await wechatApiPost<SendResponse>(account, '/cgi-bin/message/template/send', {
    touser: params.openid,
    template_id: params.templateId,
    url: params.url ?? '',
    data: params.data,
  });
  return data.msgid != null ? String(data.msgid) : '';
}

/** 设置所属行业（/cgi-bin/template/api_set_industry） */
export async function setTemplateIndustry(account: MpCredential, industryId1: string, industryId2: string): Promise<void> {
  await wechatApiPost<{ errcode?: number; errmsg?: string }>(account, '/cgi-bin/template/api_set_industry', { industry_id1: industryId1, industry_id2: industryId2 });
}

export interface WechatIndustry {
  primaryIndustry: { firstClass: string; secondClass: string } | null;
  secondaryIndustry: { firstClass: string; secondClass: string } | null;
}

interface IndustryResponse {
  errcode?: number;
  errmsg?: string;
  primary_industry?: { first_class: string; second_class: string };
  secondary_industry?: { first_class: string; second_class: string };
}

/** 获取设置的行业信息（/cgi-bin/template/get_industry） */
export async function getTemplateIndustry(account: MpCredential): Promise<WechatIndustry> {
  const data = await wechatApiGet<IndustryResponse>(account, '/cgi-bin/template/get_industry');
  return {
    primaryIndustry: data.primary_industry ? { firstClass: data.primary_industry.first_class, secondClass: data.primary_industry.second_class } : null,
    secondaryIndustry: data.secondary_industry ? { firstClass: data.secondary_industry.first_class, secondClass: data.secondary_industry.second_class } : null,
  };
}

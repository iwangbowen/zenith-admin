import type { EmailTemplate, InAppTemplate, SmsTemplate } from '../messaging/contracts';
import { SEED_DATE } from './_base';

// ─── 邮件模板 ─────────────────────────────────────────────────────────────────

export const SEED_EMAIL_TEMPLATES: EmailTemplate[] = [
  { id: 1, name: '欢迎注册邮件', code: 'user_welcome',        subject: '欢迎加入 {{appName}}', content: '<p>Hi {{nickname}}，欢迎注册 {{appName}}！请点击 {{verifyLink}} 完成账户验证（24 小时内有效）。</p>', variables: 'nickname,appName,verifyLink', status: 'enabled',  remark: '新用户注册后发送的激活邮件', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '密码重置邮件', code: 'user_reset_password', subject: '重置您的密码',         content: '<p>Hi {{nickname}}，请点击 {{resetLink}} 重置密码（2 小时内有效）。如未发起此请求，请忽略本邮件。</p>', variables: 'nickname,resetLink',          status: 'enabled',  remark: '用户密码重置流程所用模板',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '系统告警通知', code: 'system_alert',         subject: '【告警】{{title}}',    content: '<p>{{description}}</p>',                                                                              variables: 'title,description',           status: 'disabled', remark: '仅运维使用',                 createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 短信模板 ─────────────────────────────────────────────────────────────────

export const SEED_SMS_TEMPLATES: SmsTemplate[] = [
  { id: 1, name: '登录验证码', code: 'login_code',    templateCode: 'SMS_DEMO_LOGIN',    signName: 'Zenith', content: '您的登录验证码是 ${code}，5 分钟内有效。',          variables: 'code',    provider: 'aliyun', status: 'enabled', remark: '登录场景', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '注册验证码', code: 'register_code', templateCode: 'SMS_DEMO_REGISTER', signName: 'Zenith', content: '您的注册验证码是 ${code}，10 分钟内有效。',         variables: 'code',    provider: 'aliyun', status: 'enabled', remark: '注册场景', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '订单通知',   code: 'order_notify',  templateCode: 'SMS_DEMO_ORDER',    signName: 'Zenith', content: '您的订单 ${orderId} 已发货，请注意查收。', variables: 'orderId', provider: 'aliyun', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 站内信模板 ────────────────────────────────────────────────────────────────

export const SEED_INAPP_TEMPLATES: InAppTemplate[] = [
  { id: 1, name: '系统升级通知', code: 'system_upgrade',  title: '系统将于 {{time}} 升级',   content: '系统将于 {{time}} 进行升级，预计耗时 {{duration}}。', type: 'info',    variables: 'time,duration', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '审批通过',     code: 'approval_passed', title: '您的申请已通过',        content: '您提交的【{{title}}】已通过审批。',                          type: 'success', variables: 'title',        status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '异常告警',     code: 'system_warning',  title: '系统异常告警',             content: '检测到异常：{{message}}，请尽快处理。',                type: 'warning', variables: 'message',      status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export interface SeedChannel {
  id: number;
  code: string;
  name: string;
  avatar: string | null;
  description: string | null;
  type: 'system' | 'business';
  builtin: boolean;
}

export const SEED_CHANNELS: SeedChannel[] = [
  {
    id: 1,
    code: 'system-assistant',
    name: 'Zenith 助手',
    avatar: null,
    description: '系统通知与工作流提醒',
    type: 'system',
    builtin: true,
  },
  {
    id: 2,
    code: 'product-updates',
    name: '产品动态',
    avatar: null,
    description: '新功能发布、版本更新与产品公告',
    type: 'business',
    builtin: false,
  },
  {
    id: 3,
    code: 'ops-notice',
    name: '运营公告',
    avatar: null,
    description: '运营活动、维护窗口与重要通知',
    type: 'business',
    builtin: false,
  },
];

// ─── Channel 客服快捷回复（channelId 为 null = 全局，所有运营号通用） ───────────
export interface SeedChannelQuickReply {
  channelId: number | null;
  title: string;
  content: string;
  sort: number;
}

export const SEED_CHANNEL_QUICK_REPLIES: SeedChannelQuickReply[] = [
  { channelId: null, title: '欢迎语', content: '您好！很高兴为您服务，请问有什么可以帮您？', sort: 1 },
  { channelId: null, title: '稍等', content: '请稍等，正在为您查询，马上回复您～', sort: 2 },
  { channelId: null, title: '结束语', content: '感谢您的咨询，祝您生活愉快！如有问题随时联系我们。', sort: 3 },
  { channelId: null, title: '工作时间', content: '我们的客服工作时间为工作日 9:00-18:00，非工作时间留言我们会尽快回复。', sort: 4 },
];

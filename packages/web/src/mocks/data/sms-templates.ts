import type { SmsTemplate } from '@zenith/shared';

export const mockSmsTemplates: SmsTemplate[] = [
  {
    id: 1,
    name: '登录验证码',
    code: 'login_code',
    templateCode: 'SMS_111111',
    signName: 'Zenith',
    content: '您的登录验证码是 ${code}，5 分钟内有效。',
    variables: 'code',
    provider: 'aliyun',
    status: 'enabled',
    remark: '登录场景',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    name: '注册验证码',
    code: 'register_code',
    templateCode: 'SMS_222222',
    signName: 'Zenith',
    content: '您的注册验证码是 ${code}，10 分钟内有效。',
    variables: 'code',
    provider: 'aliyun',
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-02 00:00:00',
    updatedAt: '2025-01-02 00:00:00',
  },
  {
    id: 3,
    name: '订单通知',
    code: 'order_notify',
    templateCode: '333333',
    signName: 'Zenith',
    content: '您的订单 ${orderId} 已发货，请注意查收。',
    variables: 'orderId',
    provider: 'tencent',
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-03 00:00:00',
    updatedAt: '2025-01-03 00:00:00',
  },
];

let nextId = Math.max(...mockSmsTemplates.map((t) => t.id)) + 1;
export function getNextSmsTemplateId() {
  return nextId++;
}

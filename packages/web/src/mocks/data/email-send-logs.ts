import type { EmailSendLog } from '@zenith/shared';

export const mockEmailSendLogs: EmailSendLog[] = [
  {
    id: 1,
    templateId: 1,
    templateName: '欢迎邮件',
    toEmail: 'alice@example.com',
    subject: '欢迎加入 Zenith Admin',
    content: '<p>Hi Alice，欢迎加入 Zenith Admin！</p>',
    status: 'success',
    errorMsg: null,
    source: 'system',
    userId: 1,
    userName: '管理员',
    ip: '127.0.0.1',
    sentAt: '2025-03-01 10:00:00',
    createdAt: '2025-03-01 10:00:00',
  },
  {
    id: 2,
    templateId: 2,
    templateName: '密码重置',
    toEmail: 'bob@example.com',
    subject: '密码重置验证码',
    content: '<p>您的验证码是 123456，10 分钟内有效。</p>',
    status: 'failed',
    errorMsg: 'SMTP 服务器拒绝连接',
    source: 'api',
    userId: null,
    userName: null,
    ip: '10.0.0.1',
    sentAt: null,
    createdAt: '2025-03-02 14:30:00',
  },
  {
    id: 3,
    templateId: null,
    templateName: null,
    toEmail: 'test@example.com',
    subject: '测试邮件',
    content: '<p>这是一封测试邮件</p>',
    status: 'success',
    errorMsg: null,
    source: 'test',
    userId: 1,
    userName: '管理员',
    ip: '127.0.0.1',
    sentAt: '2025-03-03 09:15:00',
    createdAt: '2025-03-03 09:15:00',
  },
];

let nextId = Math.max(...mockEmailSendLogs.map((l) => l.id)) + 1;
export function getNextEmailSendLogId() {
  return nextId++;
}

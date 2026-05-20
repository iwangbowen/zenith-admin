import type { InAppTemplate } from '@zenith/shared';

export const mockInAppTemplates: InAppTemplate[] = [
  {
    id: 1,
    name: '系统升级通知',
    code: 'system_upgrade',
    title: '系统将于 {{time}} 升级',
    content: '系统将于 {{time}} 进行升级，预计耗时 {{duration}}。',
    type: 'info',
    variables: 'time,duration',
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    name: '审批通过',
    code: 'approval_passed',
    title: '您的申请已通过',
    content: '您提交的【{{title}}】已通过审批。',
    type: 'success',
    variables: 'title',
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-02 00:00:00',
    updatedAt: '2025-01-02 00:00:00',
  },
  {
    id: 3,
    name: '异常告警',
    code: 'system_warning',
    title: '系统异常告警',
    content: '检测到异常：{{message}}，请尽快处理。',
    type: 'warning',
    variables: 'message',
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-03 00:00:00',
    updatedAt: '2025-01-03 00:00:00',
  },
];

let nextId = Math.max(...mockInAppTemplates.map((t) => t.id)) + 1;
export function getNextInAppTemplateId() {
  return nextId++;
}

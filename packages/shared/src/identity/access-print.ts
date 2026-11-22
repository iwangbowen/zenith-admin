/**
 * 权限申请审批单打印字段。
 *
 * 独立于 `access-policy`：审批端（approval 入口）会加载策略计算函数，
 * 但不需要打印字段声明，放在同一模块会让打印字段进入审批端首屏。
 */
import type { WorkflowFormField } from '../workflow/types';
import {
  ACCESS_APPROVAL_POLICY_LABELS,
  ACCESS_REQUEST_TYPES,
  ACCESS_REQUEST_TYPE_LABELS,
  ACCESS_VALIDITY_MODES,
  ACCESS_VALIDITY_MODE_LABELS,
} from './access-governance-constants';
import { DATA_SCOPES, type DataScope } from './constants';

const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  all: '全部数据权限',
  custom: '指定部门数据权限',
  dept_only: '本部门数据权限',
  dept: '本部门及以下数据权限',
  self: '仅本人数据权限',
};

/** 选项值 → 文案（保持枚举顺序，供打印字段与界面共用） */
function labelOptions(values: readonly string[], labels: Readonly<Record<string, string>>) {
  return values.map(value => ({ value, label: labels[value] ?? value }));
}

/**
 * 权限申请审批单的打印字段。
 * 自定义业务表单没有 designer 表单快照，打印时按这份字段树生成版式，
 * 数据直接来自实例 formData（normalizeAccessWorkflowFormData 的输出）。
 */
export const ACCESS_REQUEST_PRINT_FIELDS: WorkflowFormField[] = [
  { key: 'targetUserName', label: '受益用户', type: 'text', columnSpan: 8 },
  {
    key: 'requestType', label: '申请类型', type: 'select', columnSpan: 8,
    options: [...ACCESS_REQUEST_TYPES],
    optionItems: labelOptions(ACCESS_REQUEST_TYPES, ACCESS_REQUEST_TYPE_LABELS),
  },
  { key: 'riskLabel', label: '风险等级', type: 'text', columnSpan: 8 },
  {
    key: 'validityMode', label: '有效期限', type: 'select', columnSpan: 8,
    options: [...ACCESS_VALIDITY_MODES],
    optionItems: labelOptions(ACCESS_VALIDITY_MODES, ACCESS_VALIDITY_MODE_LABELS),
  },
  { key: 'startsAt', label: '生效时间', type: 'date', columnSpan: 8 },
  { key: 'expiresAt', label: '失效时间', type: 'date', columnSpan: 8 },
  {
    key: 'approvalPolicy', label: '审批要求', type: 'select', columnSpan: 12,
    options: Object.keys(ACCESS_APPROVAL_POLICY_LABELS),
    optionItems: labelOptions(Object.keys(ACCESS_APPROVAL_POLICY_LABELS), ACCESS_APPROVAL_POLICY_LABELS),
  },
  { key: 'mfaRequired', label: '审批需 MFA', type: 'switch', columnSpan: 12 },
  { key: 'managerId', label: '部门负责人', type: 'userSelect', columnSpan: 8 },
  { key: 'securityApproverId', label: '安全审批人', type: 'userSelect', columnSpan: 8 },
  { key: 'secondSecurityApproverId', label: '第二安全审批', type: 'userSelect', columnSpan: 8 },
  { key: 'reason', label: '申请原因', type: 'textarea' },
  {
    key: 'permissionItems', label: '权限明细', type: 'detail', children: [
      { key: 'permissionLabel', label: '权限名称', type: 'text' },
      { key: 'permissionCode', label: '权限码', type: 'text' },
      {
        key: 'dataScope', label: '数据范围', type: 'select',
        options: [...DATA_SCOPES],
        optionItems: labelOptions(DATA_SCOPES, DATA_SCOPE_LABELS),
      },
    ],
  },
];

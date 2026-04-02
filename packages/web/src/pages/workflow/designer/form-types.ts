/**
 * 表单设计器 — 控件类型注册表 & 常量
 */
import {
  Type,
  AlignLeft,
  Hash,
  Calendar,
  CalendarRange,
  CircleDot,
  ListChecks,
  DollarSign,
  Paperclip,
  ImageIcon,
  User,
  Building2,
  Table,
  FileText,
  ListOrdered,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowFormFieldType } from '@zenith/shared';

// ─── 控件类型元信息 ──────────────────────────────────────────────────

export interface FormFieldTypeInfo {
  type: WorkflowFormFieldType;
  label: string;
  icon: LucideIcon;
  group: string;
  description?: string;
}

export const FORM_FIELD_TYPES: FormFieldTypeInfo[] = [
  // 基础控件
  { type: 'text',         label: '单行文本', icon: Type,          group: '基础控件', description: '单行文本输入' },
  { type: 'textarea',     label: '多行文本', icon: AlignLeft,     group: '基础控件', description: '多行文本输入' },
  { type: 'number',       label: '数字',     icon: Hash,          group: '基础控件', description: '数字输入' },
  { type: 'amount',       label: '金额',     icon: DollarSign,    group: '基础控件', description: '金额，支持币种设置' },
  { type: 'select',       label: '单选',     icon: CircleDot,     group: '基础控件', description: '单选下拉' },
  { type: 'multiSelect',  label: '多选',     icon: ListChecks,    group: '基础控件', description: '多选下拉' },
  { type: 'date',         label: '日期',     icon: Calendar,      group: '基础控件', description: '日期选择' },
  { type: 'dateRange',    label: '日期区间', icon: CalendarRange,  group: '基础控件', description: '起止日期选择' },

  // 高级控件
  { type: 'attachment',   label: '附件',     icon: Paperclip,     group: '高级控件', description: '上传附件' },
  { type: 'image',        label: '图片',     icon: ImageIcon,     group: '高级控件', description: '上传图片' },
  { type: 'contact',      label: '联系人',   icon: User,          group: '高级控件', description: '选择人员' },
  { type: 'department',   label: '部门',     icon: Building2,     group: '高级控件', description: '选择部门' },
  { type: 'detail',       label: '明细',     icon: Table,         group: '高级控件', description: '明细/表格，含子字段' },

  // 布局控件
  { type: 'description',  label: '说明文字', icon: FileText,      group: '布局控件', description: '纯展示说明文字' },
  { type: 'serialNumber', label: '流水号',   icon: ListOrdered,   group: '布局控件', description: '自动生成流水号' },
];

// 按分组聚合
export interface FormFieldTypeGroup {
  label: string;
  types: FormFieldTypeInfo[];
}

export const FORM_FIELD_TYPE_GROUPS: FormFieldTypeGroup[] = (() => {
  const map = new Map<string, FormFieldTypeInfo[]>();
  for (const t of FORM_FIELD_TYPES) {
    if (!map.has(t.group)) map.set(t.group, []);
    map.get(t.group)?.push(t);
  }
  return Array.from(map.entries()).map(([label, types]) => ({ label, types }));
})();

// 币种选项
export const CURRENCY_OPTIONS = [
  { value: 'CNY', label: '人民币 (¥)' },
  { value: 'USD', label: '美元 ($)' },
  { value: 'EUR', label: '欧元 (€)' },
  { value: 'GBP', label: '英镑 (£)' },
  { value: 'JPY', label: '日元 (¥)' },
];

// 日期格式选项
export const DATE_FORMAT_OPTIONS = [
  { value: 'YYYY-MM-DD',          label: '年-月-日' },
  { value: 'YYYY-MM-DD HH:mm',    label: '年-月-日 时:分' },
  { value: 'YYYY-MM-DD HH:mm:ss', label: '年-月-日 时:分:秒' },
];

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
  Table,
  FileText,
  ListOrdered,
  Columns,
  Minus,
  FolderOpen,
  Phone,
  Mail,
  IdCard,
  Link as LinkIcon,
  Star,
  Sigma,
  MapPin,
  Clock,
  PenTool,
  TextQuote,
  Circle,
  SquareCheck,
  ToggleRight,
  SlidersHorizontal,
  Tags,
  Users,
  Network,
  BookMarked,
  KeyRound,
  SquareAsterisk,
  TextCursorInput,
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
  { type: 'date',         label: '日期',     icon: Calendar,      group: '基础控件', description: '日期选择' },
  { type: 'dateRange',    label: '日期区间', icon: CalendarRange,  group: '基础控件', description: '起止日期选择' },
  { type: 'time',         label: '时间',     icon: Clock,         group: '基础控件', description: '时间选择' },

  // 选择控件
  { type: 'select',       label: '下拉单选', icon: CircleDot,     group: '选择控件', description: '下拉单选' },
  { type: 'multiSelect',  label: '下拉多选', icon: ListChecks,    group: '选择控件', description: '下拉多选' },
  { type: 'autoComplete', label: '自动完成', icon: TextCursorInput, group: '选择控件', description: '带建议项的输入' },
  { type: 'radio',        label: '单选框组', icon: Circle,        group: '选择控件', description: '单选框（横向排列）' },
  { type: 'checkbox',     label: '复选框组', icon: SquareCheck,   group: '选择控件', description: '复选框（横向排列）' },
  { type: 'switch',       label: '开关',     icon: ToggleRight,   group: '选择控件', description: '是 / 否 开关' },
  { type: 'slider',       label: '滑块',     icon: SlidersHorizontal, group: '选择控件', description: '滑块数值选择' },
  { type: 'tags',         label: '标签',     icon: Tags,          group: '选择控件', description: '多标签录入' },

  // 格式化控件
  { type: 'phone',        label: '手机号',   icon: Phone,         group: '格式化控件', description: '手机号码，含格式校验' },
  { type: 'email',        label: '邮箱',     icon: Mail,          group: '格式化控件', description: '电子邮箱，含格式校验' },
  { type: 'idCard',       label: '身份证',   icon: IdCard,        group: '格式化控件', description: '身份证号，含格式校验' },
  { type: 'url',          label: '网址',     icon: LinkIcon,      group: '格式化控件', description: 'URL 链接' },
  { type: 'password',     label: '密码',     icon: KeyRound,      group: '格式化控件', description: '密码输入（掩码）' },
  { type: 'pinCode',      label: '验证码',   icon: SquareAsterisk, group: '格式化控件', description: '定长验证码 / PIN 码' },
  { type: 'rate',         label: '评分',     icon: Star,          group: '格式化控件', description: '星级评分' },
  { type: 'formula',      label: '公式',     icon: Sigma,         group: '格式化控件', description: '从其他字段自动计算' },

  // 系统组件（与当前系统集成）
  { type: 'userSelect',   label: '人员选择', icon: Users,         group: '系统组件', description: '选择系统用户（人员）' },
  { type: 'deptSelect',   label: '部门选择', icon: Network,       group: '系统组件', description: '选择组织部门' },
  { type: 'dictSelect',   label: '字典选择', icon: BookMarked,    group: '系统组件', description: '选择数据字典项' },

  // 高级控件
  { type: 'attachment',   label: '附件',     icon: Paperclip,     group: '高级控件', description: '上传附件' },
  { type: 'image',        label: '图片',     icon: ImageIcon,     group: '高级控件', description: '上传图片' },
  { type: 'region',       label: '省市区',   icon: MapPin,        group: '高级控件', description: '省市区联动选择' },
  { type: 'signature',    label: '手写签名', icon: PenTool,       group: '高级控件', description: '手写签名板' },
  { type: 'richtext',     label: '富文本',   icon: TextQuote,     group: '高级控件', description: '富文本编辑器' },
  { type: 'detail',       label: '明细',     icon: Table,         group: '高级控件', description: '明细/表格，含子字段' },

  // 布局控件
  { type: 'description',  label: '说明文字', icon: FileText,      group: '布局控件', description: '纯展示说明文字' },
  { type: 'serialNumber', label: '流水号',   icon: ListOrdered,   group: '布局控件', description: '自动生成流水号' },

  // 布局
  { type: 'row',          label: '分栏',     icon: Columns,       group: '布局', description: '网络/分栏布局' },
  { type: 'divider',      label: '分割线',   icon: Minus,         group: '布局', description: '横向分割线' },
  { type: 'group',        label: '分组',     icon: FolderOpen,    group: '布局', description: '带有标题的分组区块' },
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

// 时间格式选项（time 字段）
export const TIME_FORMAT_OPTIONS = [
  { value: 'HH:mm',    label: '时:分' },
  { value: 'HH:mm:ss', label: '时:分:秒' },
];

// 省市区选择层级（region 字段）
export const REGION_LEVEL_OPTIONS = [
  { value: 'province', label: '省' },
  { value: 'city',     label: '省 / 市' },
  { value: 'district', label: '省 / 市 / 区' },
];

// 字段列宽选项（响应式并排，飞书风格）
export const COLUMN_SPAN_OPTIONS = [
  { value: 24, label: '整行' },
  { value: 12, label: '1/2' },
  { value: 8,  label: '1/3' },
  { value: 6,  label: '1/4' },
];

// 标签位置选项（表单级 / 字段级）
export const LABEL_POSITION_OPTIONS = [
  { value: 'top',   label: '顶部' },
  { value: 'left',  label: '左侧' },
  { value: 'inset', label: '内嵌' },
];

// 标签对齐选项（表单级 / 字段级）
export const LABEL_ALIGN_OPTIONS = [
  { value: 'left',  label: '左对齐' },
  { value: 'right', label: '右对齐' },
];

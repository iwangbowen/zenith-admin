/**
 * 表单模板库 — 完整表单级模板（字段 + 表单设置）。
 * 应用时整体替换当前表单（进设计器撤销栈，可回退）。
 * key 使用可读静态标识，便于流程条件/公式/报表直接引用。
 */
import type { WorkflowFormField, WorkflowFormSettings } from '@zenith/shared';

export interface FormTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  fields: WorkflowFormField[];
  settings: WorkflowFormSettings;
}

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    key: 'leave',
    name: '请假申请',
    category: '人事',
    description: '请假类型 / 起止日期自动算天数 / 事由，含条件必填示例',
    settings: { description: '请如实填写请假信息，提交后进入审批流程。', submitButtonText: '提交请假申请', labelPosition: 'top' },
    fields: [
      { key: 'leaveType', label: '请假类型', type: 'select', required: true, options: ['年假', '病假', '事假', '调休', '婚假', '产假'] },
      { key: 'leaveDates', label: '请假日期', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd' },
      { key: 'days', label: '请假天数', type: 'number', required: true, unit: '天', precision: 1, daysFromKey: 'leaveDates', readOnly: true },
      { key: 'reason', label: '请假事由', type: 'textarea', required: true, maxLength: 500 },
      {
        key: 'attachment', label: '证明材料', type: 'attachment', maxCount: 3,
        helpText: '病假 3 天以上需上传证明',
        requiredRules: { logic: 'and', rules: [{ field: 'leaveType', operator: 'eq', value: '病假' }] },
      },
    ],
  },
  {
    key: 'expense',
    name: '费用报销',
    category: '财务',
    description: '费用明细子表 + 公式合计 + 发票附件，含明细汇总示例',
    settings: { description: '请逐条填写费用明细并上传对应票据。', submitButtonText: '提交报销', labelPosition: 'top' },
    fields: [
      { key: 'expenseType', label: '报销类别', type: 'select', required: true, options: ['差旅费', '办公费', '业务招待费', '培训费', '其他'] },
      {
        key: 'items', label: '费用明细', type: 'detail', required: true,
        children: [
          { key: 'itemDate', label: '发生日期', type: 'date', dateFormat: 'yyyy-MM-dd' },
          { key: 'itemDesc', label: '费用说明', type: 'text' },
          { key: 'itemAmount', label: '金额', type: 'amount', precision: 2, detailSummary: true },
        ],
      },
      { key: 'totalAmount', label: '报销总额', type: 'formula', formula: 'SUM({items.itemAmount})', precision: 2, unit: '元' },
      { key: 'invoices', label: '发票/凭证', type: 'attachment', required: true, maxCount: 9, accept: '.pdf,.jpg,.png' },
      { key: 'remark', label: '备注', type: 'textarea' },
    ],
  },
  {
    key: 'purchase',
    name: '采购申请',
    category: '行政',
    description: '物品明细 + 数量单价公式小计 + 期望到货日期',
    settings: { description: '请填写采购物品与预算信息。', submitButtonText: '提交采购申请', labelPosition: 'top' },
    fields: [
      { key: 'purchaseReason', label: '采购用途', type: 'text', required: true },
      {
        key: 'goods', label: '采购明细', type: 'detail', required: true,
        children: [
          { key: 'goodsName', label: '物品名称', type: 'text' },
          { key: 'goodsQty', label: '数量', type: 'number' },
          { key: 'goodsPrice', label: '预估单价', type: 'amount', precision: 2 },
          { key: 'goodsAmount', label: '小计', type: 'amount', precision: 2, formula: '{goodsQty}*{goodsPrice}', detailSummary: true },
        ],
      },
      { key: 'budget', label: '预算总额', type: 'formula', formula: 'SUM({goods.goodsAmount})', precision: 2, unit: '元' },
      { key: 'expectDate', label: '期望到货日期', type: 'date', dateFormat: 'yyyy-MM-dd', dateLimit: 'noPast' },
      { key: 'supplier', label: '建议供应商', type: 'text' },
    ],
  },
  {
    key: 'onboard',
    name: '入职办理',
    category: '人事',
    description: '分组布局 + 系统人员/部门选择 + 格式化控件示例',
    settings: { description: '请人事专员填写新员工入职信息。', submitButtonText: '提交入职单', labelPosition: 'top' },
    fields: [
      {
        key: 'basicGroup', label: '基本信息', type: 'group', title: '基本信息',
        children: [
          { key: 'staffName', label: '姓名', type: 'text', required: true, columnSpan: 12 },
          { key: 'staffPhone', label: '手机号', type: 'phone', required: true, columnSpan: 12 },
          { key: 'staffEmail', label: '邮箱', type: 'email', columnSpan: 12 },
          { key: 'staffIdCard', label: '身份证号', type: 'idCard', columnSpan: 12 },
        ],
      },
      {
        key: 'jobGroup', label: '任职信息', type: 'group', title: '任职信息',
        children: [
          { key: 'dept', label: '入职部门', type: 'deptSelect', required: true, columnSpan: 12 },
          { key: 'mentor', label: '带教导师', type: 'userSelect', columnSpan: 12 },
          { key: 'onboardDate', label: '入职日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd', columnSpan: 12 },
          { key: 'probation', label: '试用期（月）', type: 'number', min: 0, max: 6, columnSpan: 12 },
        ],
      },
      { key: 'onboardRemark', label: '备注', type: 'textarea' },
    ],
  },
  {
    key: 'trip',
    name: '出差申请',
    category: '人事',
    description: '省市区目的地 + 日期区间天数联动 + 同行人多选',
    settings: { description: '请提前提交出差申请以便安排。', submitButtonText: '提交出差申请', labelPosition: 'top' },
    fields: [
      { key: 'tripDest', label: '出差地点', type: 'region', required: true, regionLevel: 'city' },
      { key: 'tripDates', label: '出差日期', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd' },
      { key: 'tripDays', label: '出差天数', type: 'number', unit: '天', precision: 0, daysFromKey: 'tripDates', readOnly: true },
      { key: 'companions', label: '同行人', type: 'userSelect', multiple: true },
      { key: 'tripPurpose', label: '出差事由', type: 'textarea', required: true },
      { key: 'needAdvance', label: '是否需要借款', type: 'switch', defaultValue: false },
      {
        key: 'advanceAmount', label: '借款金额', type: 'amount', precision: 2, unit: '元',
        visibilityRules: { logic: 'and', rules: [{ field: 'needAdvance', operator: 'eq', value: true }] },
        requiredRules: { logic: 'and', rules: [{ field: 'needAdvance', operator: 'eq', value: true }] },
      },
    ],
  },
  {
    key: 'contract',
    name: '合同审批',
    category: '法务',
    description: '标签页布局 + 金额中文大写 + 校验公式（终止日期晚于生效日期）',
    settings: { description: '请完整填写合同信息并上传合同文本。', submitButtonText: '提交合同审批', labelPosition: 'top' },
    fields: [
      {
        key: 'contractTabs', label: '合同信息', type: 'tabs',
        panes: [
          {
            title: '基本信息',
            fields: [
              { key: 'contractName', label: '合同名称', type: 'text', required: true },
              { key: 'partner', label: '签约对方', type: 'text', required: true },
              { key: 'contractAmount', label: '合同金额', type: 'amount', required: true, precision: 2, currency: 'CNY', amountInWords: true },
            ],
          },
          {
            title: '期限与条款',
            fields: [
              { key: 'startDate', label: '生效日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
              {
                key: 'endDate', label: '终止日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd',
                compareRules: [{ operator: 'gt', field: 'startDate', message: '终止日期需晚于生效日期' }],
              },
              { key: 'keyTerms', label: '关键条款摘要', type: 'textarea' },
            ],
          },
        ],
      },
      { key: 'contractFile', label: '合同文本', type: 'attachment', required: true, maxCount: 5, accept: '.pdf,.doc,.docx' },
    ],
  },
];

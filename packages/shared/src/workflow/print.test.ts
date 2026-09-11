/**
 * 审批单打印纯逻辑单测：字段格式化、引用收集、数据集构建、自动版式生成（结构合法 + 可渲染）。
 */
import { describe, expect, it } from 'vitest';
import { reportPrintContentSchema } from '../report/validation';
import { renderPrintContent } from '../report/print';
import type { WorkflowInstance } from './contracts/instances';
import type { WorkflowFormField } from './types';
import {
  buildWorkflowPrintDatasets,
  collectWorkflowPrintLookupIds,
  describeWorkflowPrintDatasets,
  emptyWorkflowPrintLookups,
  formatWorkflowPrintNumber,
  formatWorkflowPrintValue,
  generateWorkflowPrintContent,
  workflowPrintDetailDatasetKey,
  workflowPrintFieldKey,
  workflowPrintPageConfig,
} from './print';

const field = (partial: Partial<WorkflowFormField> & Pick<WorkflowFormField, 'key' | 'type'>): WorkflowFormField => ({
  label: partial.key,
  ...partial,
});

const FIELDS: WorkflowFormField[] = [
  field({ key: 'reason', type: 'textarea', label: '申请事由' }),
  field({
    key: 'layout_row', type: 'row', label: '',
    columns: [
      { span: 12, fields: [field({ key: 'type', type: 'select', label: '请假类型', optionItems: [{ value: 'annual', label: '年假' }] })] },
      { span: 12, fields: [
        field({ key: 'days', type: 'number', label: '天数', unit: '天' }),
        field({ key: 'range', type: 'dateRange', label: '请假区间' }),
      ] },
    ],
  }),
  field({
    key: 'grp', type: 'group', title: '费用', label: '费用',
    children: [
      field({ key: 'amount', type: 'amount', label: '金额', precision: 2, unit: '元', columnSpan: 12 }),
      field({ key: 'agent', type: 'userSelect', label: '代理人', columnSpan: 12 }),
    ],
  }),
  field({
    key: 'items', type: 'detail', label: '费用明细',
    children: [
      field({ key: 'name', type: 'text', label: '项目' }),
      field({ key: 'qty', type: 'number', label: '数量', detailSummary: true }),
      field({ key: 'price', type: 'amount', label: '单价' }),
    ],
  }),
  field({ key: 'secret', type: 'password', label: '口令' }),
  field({ key: 'sign', type: 'signature', label: '申请人签名' }),
  field({ key: 'note', type: 'description', label: '说明', description: '仅供参考' }),
];

const INSTANCE: WorkflowInstance = {
  id: 7,
  definitionId: 3,
  definitionName: '请假申请',
  categoryName: '人事',
  title: '张三的请假申请',
  serialNo: 'QJ-20260911-0007',
  priority: 'high',
  formData: {
    reason: '家中有事\n需要请假两天',
    type: 'annual',
    days: 2,
    range: ['2026-09-12', '2026-09-13'],
    amount: 1234.5,
    agent: [11, 12],
    items: [
      { name: '交通', qty: 2, price: 100 },
      { name: '住宿', qty: '3', price: 200 },
      { name: '空数量', qty: '', price: 0 },
    ],
    secret: 'p@ss',
    sign: 'data:image/png;base64,iVBORw0KGgo=',
  },
  formSnapshot: { formType: 'designer', formId: 1, formName: '请假单', fields: FIELDS, settings: null, customForm: null },
  status: 'approved',
  currentNodeKey: null,
  initiatorId: 1,
  initiatorName: '张三',
  tenantId: null,
  tasks: [
    { id: 1, instanceId: 7, nodeKey: 'n1', nodeName: '直属领导', nodeType: 'approve', assigneeId: 2, assigneeName: '李四', status: 'approved', comment: '同意', signature: 'data:image/png;base64,AAAA', actionAt: '2026-09-11 10:00:00', createdAt: '2026-09-11 09:00:00', approveMethod: 'or', signType: null },
    { id: 2, instanceId: 7, nodeKey: 'cc1', nodeName: '抄送 HR', nodeType: 'ccNode', assigneeId: 3, assigneeName: '王五', status: 'approved', comment: null, actionAt: null, createdAt: '2026-09-11 10:00:01' },
    { id: 3, instanceId: 7, nodeKey: 'n2', nodeName: '被排除', nodeType: 'approve', assigneeId: 4, assigneeName: '赵六', status: 'skipped', comment: null, actionAt: null, createdAt: '2026-09-11 10:00:02', signType: 'excluded' },
  ],
  comments: [{ id: 1, instanceId: 7, userId: 1, userName: '张三', content: '补充说明', mentions: [], attachments: [], createdAt: '2026-09-11 09:30:00' }],
  createdAt: '2026-09-11 09:00:00',
  updatedAt: '2026-09-11 10:00:00',
};

describe('formatWorkflowPrintValue', () => {
  const lookups = emptyWorkflowPrintLookups();
  lookups.userNames.set(11, '甲');
  lookups.dictLabels.set('city', new Map([['sh', '上海']]));

  it('按字段类型格式化：选项标签、金额千分位、单位、人员名称、字典标签', () => {
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'select', optionItems: [{ value: 'x', label: '甲选项' }] }), 'x', lookups)).toBe('甲选项');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'amount', unit: '元' }), 1234567.891, lookups)).toBe('1,234,567.89 元');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'number', unit: '天' }), 2, lookups)).toBe('2 天');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'userSelect' }), [11, 99], lookups)).toBe('甲、用户#99');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'dictSelect', dictCode: 'city' }), ['sh', 'bj'], lookups)).toBe('上海、bj');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'switch' }), true, lookups)).toBe('是');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'dateRange' }), ['2026-01-01', '2026-01-03'], lookups)).toBe('2026-01-01 ~ 2026-01-03');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'attachment' }), [{ name: 'a.pdf', url: '/x' }, { name: 'b.png', url: '/y' }], lookups)).toBe('a.pdf、b.png');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'richtext' }), '<p>第一段</p><p>第二段&amp;</p>', lookups)).toBe('第一段\n第二段&');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'location' }), { address: '上海市', lng: 121, lat: 31 }, lookups)).toBe('上海市');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'matrix' }), { 服务: '满意', 速度: '一般' }, lookups)).toBe('服务：满意；速度：一般');
    expect(formatWorkflowPrintValue(field({ key: 'a', type: 'text' }), null, lookups)).toBe('');
  });

  it('千分位格式不依赖 toLocaleString', () => {
    expect(formatWorkflowPrintNumber(-1234567.5, 2)).toBe('-1,234,567.50');
    expect(formatWorkflowPrintNumber(999)).toBe('999');
    expect(formatWorkflowPrintNumber(1000.25)).toBe('1,000.25');
  });
});

describe('collectWorkflowPrintLookupIds', () => {
  it('收集人员 / 部门 / 字典 / 关联引用，含明细子字段', () => {
    const fields = [
      ...FIELDS,
      field({ key: 'dept', type: 'deptSelect' }),
      field({ key: 'rel', type: 'relation' }),
      field({ key: 'd2', type: 'detail', children: [field({ key: 'owner', type: 'userSelect' }), field({ key: 'city', type: 'dictSelect', dictCode: 'city' })] }),
    ];
    const ids = collectWorkflowPrintLookupIds(fields, {
      ...INSTANCE.formData,
      dept: 5,
      rel: [{ id: 42 }],
      d2: [{ owner: 21, city: 'sh' }, { owner: [22, 21] }],
    });
    expect(ids.userIds.sort()).toEqual([11, 12, 21, 22]);
    expect(ids.deptIds).toEqual([5]);
    expect(ids.relationIds).toEqual([42]);
    expect(ids.dictCodes).toEqual(['city']);
  });
});

describe('buildWorkflowPrintDatasets', () => {
  const lookups = emptyWorkflowPrintLookups();
  lookups.userNames.set(11, '甲').set(12, '乙');
  const datasets = buildWorkflowPrintDatasets({ instance: INSTANCE, fields: FIELDS, lookups, initiatorDeptName: '研发部', printerName: '管理员', printedAt: '2026-09-11 11:00:00' });

  it('instance 单行：打印标题、状态文案、抄送人、完成时间、附件数', () => {
    const row = datasets.instance[0];
    expect(row.printTitle).toBe('请假申请审批单');
    expect(row.statusText).toBe('已通过');
    expect(row.priorityText).toBe('高');
    expect(row.ccNames).toBe('王五');
    expect(row.finishedAt).toBe('2026-09-11 10:00:00');
    expect(row.initiatorDeptName).toBe('研发部');
    expect(row.printerName).toBe('管理员');
  });

  it('form 单行按字段格式化，跳过密码 / 说明，签名保留 data URL', () => {
    const row = datasets.form[0];
    expect(row.type).toBe('年假');
    expect(row.days).toBe('2 天');
    expect(row.amount).toBe('1,234.50 元');
    expect(row.agent).toBe('甲、乙');
    expect(row.items).toBe('共 3 行');
    expect(row.sign).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(row).not.toHaveProperty('secret');
    expect(row).not.toHaveProperty('note');
    expect(datasets.form_fields.map((r) => r.key)).not.toContain('sign');
  });

  it('明细子表：数值列保留数值供合计，空值为空串，带序号', () => {
    const rows = datasets[workflowPrintDetailDatasetKey('items')];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ _index: 1, name: '交通', qty: 2, price: 100 });
    expect(rows[1].qty).toBe(3);
    expect(rows[2].qty).toBe('');
  });

  it('tasks 只含真实审批环节：排除抄送与 excluded 留痕；cc 单独成集', () => {
    expect(datasets.tasks.map((t) => t.nodeName)).toEqual(['直属领导']);
    expect(datasets.tasks[0]).toMatchObject({ statusText: '已通过', approveMethodText: '或签', signature: 'data:image/png;base64,AAAA' });
    expect(datasets.cc).toEqual([{ nodeName: '抄送 HR', assigneeName: '王五', createdAt: '2026-09-11 10:00:01' }]);
    expect(datasets.comments).toHaveLength(1);
  });
});

describe('generateWorkflowPrintContent', () => {
  const content = generateWorkflowPrintContent(FIELDS, { includeComments: true, includeCc: true });
  const sheet = content.sheets![0];

  it('生成内容通过报表打印内容 schema 校验（含重复块 / 合并区域边界）', () => {
    const parsed = reportPrintContentSchema.safeParse(content);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });

  it('单元格互不重叠：任一 (row, col) 至多被一个单元格（含合并区域）覆盖', () => {
    const covered = new Set<string>();
    const merges = new Map(sheet.grid.merges!.map((m) => [`${m.row}:${m.col}`, m]));
    for (const cell of sheet.grid.cells) {
      const merge = merges.get(`${cell.row}:${cell.col}`);
      const rowSpan = merge?.rowSpan ?? 1;
      const colSpan = merge?.colSpan ?? 1;
      for (let r = cell.row; r < cell.row + rowSpan; r++) {
        for (let c = cell.col; c < cell.col + colSpan; c++) {
          const key = `${r}:${c}`;
          expect(covered.has(key), `重叠单元格 ${key}`).toBe(false);
          covered.add(key);
        }
      }
    }
    expect(sheet.grid.rowHeights).toHaveLength(sheet.grid.rows);
  });

  it('栅格行两列并排、明细形成重复块、签名为图片单元格、密码与说明不出现', () => {
    const texts = sheet.grid.cells.map((c) => String(c.v ?? ''));
    expect(texts).toContain('请假类型');
    expect(texts).toContain('天数');
    expect(texts).not.toContain('口令');
    expect(texts).not.toContain('说明');
    const typeLabel = sheet.grid.cells.find((c) => c.v === '请假类型')!;
    const daysLabel = sheet.grid.cells.find((c) => c.v === '天数')!;
    expect(daysLabel.row).toBe(typeLabel.row);
    expect(daysLabel.col).toBe(12);
    const rangeLabel = sheet.grid.cells.find((c) => c.v === '请假区间')!;
    expect(rangeLabel.row).toBe(typeLabel.row + 1);
    // 左列较短：用空白边框单元格补齐到右列高度
    const filler = sheet.grid.merges!.find((m) => m.row === rangeLabel.row && m.col === 0 && m.colSpan === 12);
    expect(filler).toBeDefined();

    const blockIds = sheet.repeatBlocks!.map((b) => b.id);
    expect(blockIds).toEqual(expect.arrayContaining(['detail_items', 'tasks', 'comments']));
    const sumCell = sheet.grid.cells.find((c) => c.v === '${SUM(qty)}')!;
    expect(sumCell.datasetKey).toBe(workflowPrintDetailDatasetKey('items'));

    const signature = sheet.grid.cells.find((c) => c.kind === 'image' && c.datasetKey === 'form')!;
    expect(signature.image?.src).toBe(`\${${workflowPrintFieldKey('sign')}}`);
    const taskSignature = sheet.grid.cells.find((c) => c.kind === 'image' && c.datasetKey === 'tasks')!;
    expect(taskSignature.image?.src).toBe('${signature}');
  });

  it('端到端渲染：数据集注入后标题 / 表单值 / 审批记录逐行展开 / 合计求和', () => {
    const lookups = emptyWorkflowPrintLookups();
    lookups.userNames.set(11, '甲').set(12, '乙');
    const datasets = buildWorkflowPrintDatasets({ instance: INSTANCE, fields: FIELDS, lookups, printerName: '管理员', printedAt: '2026-09-11 11:00:00' });
    const result = renderPrintContent('审批单', content, datasets.instance, {}, workflowPrintPageConfig(), { datasets, renderedAt: '2026-09-11 11:00:00' });
    expect(result.pages.length).toBeGreaterThan(0);
    const values = result.grid.cells.map((c) => c.v);
    expect(values).toContain('请假申请审批单');
    expect(values).toContain('编号：QJ-20260911-0007    状态：已通过    发起时间：2026-09-11 09:00:00');
    expect(values).toContain('年假');
    expect(values).toContain('1,234.50 元');
    expect(values).toContain('甲、乙');
    expect(values).toContain('直属领导');
    expect(values).toContain('王五'); // 抄送行
    expect(values).toContain('补充说明'); // 沟通记录
    expect(values).toContain(5); // ${SUM(qty)} = 2 + 3
    expect(values).toContain('交通');
    expect(values).toContain('住宿');
    const signatureCell = result.grid.cells.find((c) => c.kind === 'image' && c.image?.src === 'data:image/png;base64,AAAA');
    expect(signatureCell).toBeDefined();
    expect(result.pages[0].footerText).toBe('第 1 / 1 页');
    // 多行文本自动抬高行高
    const reasonCell = result.grid.cells.find((c) => c.v === '家中有事\n需要请假两天')!;
    expect(result.grid.rowHeights![reasonCell.row]).toBeGreaterThanOrEqual(52);
  });

  it('无表单字段（自定义业务表单）仍生成完整审批单骨架', () => {
    const empty = generateWorkflowPrintContent([]);
    const texts = empty.sheets![0].grid.cells.map((c) => String(c.v ?? ''));
    expect(texts).toContain('（该流程使用自定义业务表单，无表单快照）');
    expect(texts).toContain('审批记录');
    expect(reportPrintContentSchema.safeParse(empty).success).toBe(true);
  });
});

describe('describeWorkflowPrintDatasets', () => {
  it('字段目录包含固定数据集与明细子表，签名列标记为图片', () => {
    const sets = describeWorkflowPrintDatasets(FIELDS);
    expect(sets.map((s) => s.key)).toEqual(['instance', 'form', 'form_fields', workflowPrintDetailDatasetKey('items'), 'tasks', 'cc', 'comments', 'consults', 'attachments']);
    const form = sets.find((s) => s.key === 'form')!;
    expect(form.columns.find((c) => c.key === 'sign')?.kind).toBe('image');
    expect(form.columns.map((c) => c.key)).not.toContain('secret');
    const detail = sets.find((s) => s.key === workflowPrintDetailDatasetKey('items'))!;
    expect(detail.cardinality).toBe('rows');
    expect(detail.columns.map((c) => c.key)).toEqual(['name', 'qty', 'price']);
  });
});

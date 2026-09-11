import { describe, expect, it } from 'vitest';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { reportPrintContentSchema } from '@zenith/shared/report';
import { buildEntityPrintCatalog, buildEntityTemplateDraft, entityDatasetKeys, entityMainDatasetKey, findInvalidEntityDatasetRef } from './entity-print';
import { printContentToUniver, univerToPrintContent } from './print-univer';

const FIELDS: WorkflowFormField[] = [
  { key: 'amount', label: '金额', type: 'amount', columnSpan: 12 },
  { key: 'days', label: '天数', type: 'number', columnSpan: 12 },
  { key: 'items', label: '明细', type: 'detail', children: [{ key: 'name', label: '项目', type: 'text' }, { key: 'qty', label: '数量', type: 'number' }] },
  { key: 'sign', label: '签名', type: 'signature' },
];

describe('entity-print', () => {
  it('目录：主数据集为 instance，明细子表按字段 key 派生，签名列为图片', () => {
    const catalog = buildEntityPrintCatalog('workflow_instance', FIELDS);
    expect(entityMainDatasetKey(catalog)).toBe('instance');
    expect(entityDatasetKeys(catalog)).toEqual(expect.arrayContaining(['instance', 'form', 'form_items', 'tasks', 'cc', 'comments']));
    expect(catalog.datasets.find((d) => d.key === 'form')?.columns.find((c) => c.key === 'sign')?.kind).toBe('image');
  });

  it('生成草稿可往返 Univer：网格、合并、重复块与页面配置在快照转换后保持', () => {
    const draft = buildEntityTemplateDraft('workflow_instance', FIELDS);
    expect(reportPrintContentSchema.safeParse(draft.content).success).toBe(true);
    const snapshot = printContentToUniver(draft.content, '审批单');
    const roundTrip = univerToPrintContent(snapshot);
    const sheet = roundTrip.sheets![0];
    const source = draft.sheets[0];
    expect(sheet.grid.cells.length).toBe(source.grid.cells.length);
    expect(sheet.grid.merges?.length).toBe(source.grid.merges?.length);
    expect(sheet.repeatBlocks?.map((b) => b.id)).toEqual(source.repeatBlocks?.map((b) => b.id));
    expect(sheet.pageConfig?.paper).toBe('A4');
    // 图片单元格与数据集标记经 custom 元数据保留
    const signature = sheet.grid.cells.find((c) => c.kind === 'image');
    expect(signature?.image?.src).toBe('${sign}');
    expect(signature?.datasetKey).toBe('form');
  });

  it('引用校验：实体数据集与附加绑定放行，未知键报出位置', () => {
    const draft = buildEntityTemplateDraft('workflow_instance', FIELDS);
    const keys = entityDatasetKeys(buildEntityPrintCatalog('workflow_instance', FIELDS));
    expect(findInvalidEntityDatasetRef(draft.content, keys)).toBeNull();
    expect(findInvalidEntityDatasetRef(draft.content, ['instance'])).toMatch(/重复块|单元格/);
    const bad = { sheets: [{ id: 's', name: 'S', datasetKey: 'ghost', grid: { rows: 1, cols: 1, cells: [] } }] };
    expect(findInvalidEntityDatasetRef(bad, keys)).toContain('ghost');
  });
});

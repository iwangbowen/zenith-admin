/**
 * 字典项批量导入 Definition：按字典编码归属，(dictId, value) 唯一。
 */
import { db } from '../../../db/index';
import { dictItems, dicts } from '../../../db/schema';
import { tenantCondition } from '../../../lib/tenant';
import { currentUser } from '../../../lib/context';
import { registerImport } from '../../../lib/import-center/registry';

interface DictItemRow {
  dictId: number;
  dictCode: string;
  label: string;
  value: string;
  sort: number;
  status: 'enabled' | 'disabled';
  remark: string | null;
}

interface Prepared {
  dictByCode: Map<string, number>;
  /** `${dictId}:${value}` 查重集合 */
  existing: Set<string>;
}

export function registerDictItemsImport(): void {
  registerImport<DictItemRow, Prepared>({
    entity: 'platform.dict-items',
    title: '字典项',
    module: '系统设置',
    permission: 'system:dict:create',
    description: '按字典编码批量补充字典项，同字典内项值唯一（重复值该行报错）',
    columns: [
      { key: 'dictCode', header: '字典编码', required: true, example: 'common_status' },
      { key: 'label', header: '项标签', required: true, example: '启用' },
      { key: 'value', header: '项值', required: true, example: 'enabled' },
      { key: 'sort', header: '排序', example: '1', note: '数字，越小越靠前' },
      { key: 'status', header: '状态', enumValues: ['enabled', 'disabled'], example: 'enabled' },
      { key: 'remark', header: '备注' },
    ],
    async prepare() {
      const user = currentUser();
      const [allDicts, allItems] = await Promise.all([
        db.select({ id: dicts.id, code: dicts.code }).from(dicts).where(tenantCondition(dicts, user)),
        db.select({ dictId: dictItems.dictId, value: dictItems.value }).from(dictItems),
      ]);
      return {
        dictByCode: new Map(allDicts.map((d) => [d.code, d.id])),
        existing: new Set(allItems.map((i) => `${i.dictId}:${i.value}`)),
      };
    },
    parseRow(cells, prepared) {
      if (!cells.dictCode || !cells.label || !cells.value) throw new Error('字典编码、项标签、项值为必填项');
      const dictId = prepared.dictByCode.get(cells.dictCode);
      if (!dictId) throw new Error(`字典编码不存在: ${cells.dictCode}`);
      if (cells.label.length > 64 || cells.value.length > 64) throw new Error('项标签/项值最长 64 字符');
      if (prepared.existing.has(`${dictId}:${cells.value}`)) {
        throw new Error(`字典「${cells.dictCode}」中项值已存在: ${cells.value}`);
      }
      let sort = 0;
      if (cells.sort) {
        sort = Number(cells.sort);
        if (!Number.isInteger(sort)) throw new Error(`排序需为整数: ${cells.sort}`);
      }
      let status: 'enabled' | 'disabled' = 'enabled';
      if (cells.status) {
        const normalized = cells.status.toLowerCase();
        if (normalized !== 'enabled' && normalized !== 'disabled') {
          throw new Error(`状态值无效: ${cells.status}（仅支持 enabled/disabled 或留空）`);
        }
        status = normalized;
      }
      return {
        dictId,
        dictCode: cells.dictCode,
        label: cells.label,
        value: cells.value,
        sort,
        status,
        remark: cells.remark || null,
      };
    },
    async insertRow(row, prepared) {
      await db.insert(dictItems).values({
        dictId: row.dictId,
        label: row.label,
        value: row.value,
        sort: row.sort,
        status: row.status,
        remark: row.remark,
      });
      prepared.existing.add(`${row.dictId}:${row.value}`);
    },
    rowLabel: (row) => `${row.dictCode} / ${row.label}`,
  });
}

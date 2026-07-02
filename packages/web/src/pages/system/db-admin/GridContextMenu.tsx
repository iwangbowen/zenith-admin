import { useMemo } from 'react';
import { Dropdown, Toast } from '@douyinfe/semi-ui';

import type { CellPos, DataGridColumn, SelectionSnapshot } from '@/components/data-grid';
import {
  columnKind,
  copyValue,
  snapshotToCsv,
  snapshotToJson,
  snapshotToMarkdown,
  snapshotToTsv,
  writeClipboard,
} from '@/components/data-grid';
import { buildInsertSql, buildUpdateSql } from './sql-format';

export interface GridMenuState {
  x: number;
  y: number;
  pos: CellPos;
  snapshot: SelectionSnapshot;
  /** 菜单打开时刻的可见列（与快照 col 下标对齐） */
  columns: DataGridColumn[];
}

interface GridContextMenuProps {
  menu: GridMenuState | null;
  onClose: () => void;
  rows: Array<Record<string, unknown>>;
  schema?: string;
  table?: string;
  primaryKey: string[];
  canEditRows: boolean;
  onFilterByValue: (column: string, encoded: string) => void;
  onOpenDetail: (pos: CellPos) => void;
  onEditRow: (rowIndex: number, focusField?: string) => void;
  onDeleteRows: (rowIndexes: number[]) => void;
  /** 暂存「设为 NULL」（内联编辑启用时提供） */
  onSetNull?: (rowIndex: number, columnName: string) => void;
}

async function copyAndToast(text: string, msg: string): Promise<void> {
  const ok = await writeClipboard(text);
  if (ok) Toast.success(msg);
  else Toast.warning('复制失败');
}

/** 数据网格右键菜单：复制 / 按值筛选 / 详情 / 行操作 */
export function GridContextMenu(props: GridContextMenuProps) {
  const {
    menu, onClose, rows, schema, table, primaryKey,
    canEditRows, onFilterByValue, onOpenDetail, onEditRow, onDeleteRows, onSetNull,
  } = props;

  const menuContent = useMemo(() => {
    if (!menu) return null;
    const { pos, snapshot, columns } = menu;
    const column = columns[pos.col];
    const cellValue = column ? rows[pos.row]?.[column.name] : undefined;
    const cellIsNull = cellValue === null || cellValue === undefined;
    const kind = columnKind(column?.dataType);
    const serializeCtx = { snapshot, rows, columns };
    const multi = snapshot.cellCount > 1;
    const selRowIndexes = snapshot.rowIndexes;
    const canSql = Boolean(schema && table);

    const cleanRow = (r: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) if (!k.startsWith('__')) out[k] = v;
      return out;
    };

    const copyInsert = () => {
      if (!schema || !table) return;
      const sqls = selRowIndexes
        .map((i) => rows[i])
        .filter(Boolean)
        .map((r) => buildInsertSql(schema, table, cleanRow(r)));
      void copyAndToast(sqls.join('\n'), `已复制 ${sqls.length} 条 INSERT SQL`);
    };

    const copyUpdate = () => {
      if (!schema || !table || primaryKey.length === 0) return;
      const sqls = selRowIndexes
        .map((i) => rows[i])
        .filter(Boolean)
        .map((r) => {
          const pk: Record<string, unknown> = {};
          for (const k of primaryKey) pk[k] = r[k];
          const changes: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(cleanRow(r))) {
            if (!primaryKey.includes(k)) changes[k] = v;
          }
          return buildUpdateSql(schema, table, pk, changes);
        });
      void copyAndToast(sqls.join('\n'), `已复制 ${sqls.length} 条 UPDATE SQL`);
    };

    const filterValue = cellIsNull ? '' : copyValue(cellValue, kind);

    return (
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => { void copyAndToast(copyValue(cellValue, kind), '已复制值'); onClose(); }}>
          复制值
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { if (column) void copyAndToast(column.name, '已复制列名'); onClose(); }}>
          复制列名
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { onOpenDetail(pos); onClose(); }}>
          查看详情
        </Dropdown.Item>
        {multi && (
          <>
            <Dropdown.Divider />
            <Dropdown.Item onClick={() => { void copyAndToast(snapshotToTsv(serializeCtx), `已复制 ${snapshot.cellCount} 格 (TSV)`); onClose(); }}>
              复制选区 (TSV)
            </Dropdown.Item>
            <Dropdown.Item onClick={() => { void copyAndToast(snapshotToCsv(serializeCtx), '已复制选区 (CSV)'); onClose(); }}>
              复制选区 (CSV)
            </Dropdown.Item>
            <Dropdown.Item onClick={() => { void copyAndToast(snapshotToJson(serializeCtx), '已复制选区 (JSON)'); onClose(); }}>
              复制选区 (JSON)
            </Dropdown.Item>
            <Dropdown.Item onClick={() => { void copyAndToast(snapshotToMarkdown(serializeCtx), '已复制选区 (Markdown)'); onClose(); }}>
              复制选区 (Markdown)
            </Dropdown.Item>
          </>
        )}
        {canSql && selRowIndexes.length > 0 && (
          <>
            <Dropdown.Divider />
            <Dropdown.Item onClick={() => { copyInsert(); onClose(); }}>
              复制行为 INSERT SQL{selRowIndexes.length > 1 ? `（${selRowIndexes.length} 行）` : ''}
            </Dropdown.Item>
            {primaryKey.length > 0 && (
              <Dropdown.Item onClick={() => { copyUpdate(); onClose(); }}>
                复制行为 UPDATE SQL{selRowIndexes.length > 1 ? `（${selRowIndexes.length} 行）` : ''}
              </Dropdown.Item>
            )}
          </>
        )}
        {column && (
          <>
            <Dropdown.Divider />
            {!cellIsNull && (
              <>
                <Dropdown.Item onClick={() => { onFilterByValue(column.name, `eq|${filterValue}`); onClose(); }}>
                  筛选：等于此值
                </Dropdown.Item>
                <Dropdown.Item onClick={() => { onFilterByValue(column.name, `neq|${filterValue}`); onClose(); }}>
                  筛选：不等于此值
                </Dropdown.Item>
                <Dropdown.Item onClick={() => { onFilterByValue(column.name, `ilike|${filterValue}`); onClose(); }}>
                  筛选：包含此值
                </Dropdown.Item>
              </>
            )}
            <Dropdown.Item onClick={() => { onFilterByValue(column.name, 'isnull|'); onClose(); }}>
              筛选：IS NULL
            </Dropdown.Item>
            {cellIsNull && (
              <Dropdown.Item onClick={() => { onFilterByValue(column.name, 'notnull|'); onClose(); }}>
                筛选：IS NOT NULL
              </Dropdown.Item>
            )}
          </>
        )}
        {canEditRows && (
          <>
            <Dropdown.Divider />
            {onSetNull && column && !column.isPrimaryKey && column.nullable !== false && (
              <Dropdown.Item
                disabled={cellIsNull}
                onClick={() => { onSetNull(pos.row, column.name); onClose(); }}
              >
                设为 NULL（暂存）
              </Dropdown.Item>
            )}
            <Dropdown.Item onClick={() => { onEditRow(pos.row, column?.name); onClose(); }}>
              编辑行
            </Dropdown.Item>
            <Dropdown.Item
              type="danger"
              onClick={() => {
                onDeleteRows(selRowIndexes.length > 0 ? selRowIndexes : [pos.row]);
                onClose();
              }}
            >
              删除行{selRowIndexes.length > 1 ? `（${selRowIndexes.length} 行）` : ''}
            </Dropdown.Item>
          </>
        )}
      </Dropdown.Menu>
    );
  }, [menu, rows, schema, table, primaryKey, canEditRows, onFilterByValue, onOpenDetail, onEditRow, onDeleteRows, onSetNull, onClose]);

  if (!menu) return null;

  return (
    <Dropdown
      visible
      trigger="custom"
      position="bottomLeft"
      render={menuContent}
      onClickOutSide={onClose}
      getPopupContainer={() => document.body}
      clickToHide
      onVisibleChange={(v) => { if (!v) onClose(); }}
    >
      <div style={{ position: 'fixed', left: menu.x, top: menu.y, width: 1, height: 1, pointerEvents: 'none' }} />
    </Dropdown>
  );
}

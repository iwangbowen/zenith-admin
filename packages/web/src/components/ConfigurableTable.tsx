import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { Button, Checkbox, Dropdown, Space, Table } from '@douyinfe/semi-ui';
import { RotateCcw, Settings2 } from 'lucide-react';
import type { ColumnProps, Data, TableProps } from '@douyinfe/semi-ui/lib/es/table';

type TableRecord = Data;
type ConfigurableColumn<RecordType extends TableRecord> = ColumnProps<RecordType> & {
  children?: ConfigurableColumn<RecordType>[];
};

interface ColumnOption {
  key: string;
  title: string;
  alwaysVisible: boolean;
}

interface ConfigurableTableProps<RecordType extends TableRecord = TableRecord> extends TableProps<RecordType> {
  columnSettings?: boolean;
  columnSettingsKey?: string;
  alwaysVisibleColumnKeys?: string[];
  columnSettingsLabel?: string;
  /** 当使用 useTransition 搜索时，传入 isPending 以显示半透明加载效果（旧数据保持可见） */
  pending?: boolean;
}

const DEFAULT_ALWAYS_VISIBLE_KEYS = ['action', 'actions', 'operation', 'operations', 'operate'];
const DEFAULT_ALWAYS_VISIBLE_TITLES = ['操作'];

function getTitleText(title: ColumnProps<TableRecord>['title']): string | undefined {
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  return undefined;
}

function getColumnKey<RecordType extends TableRecord>(
  column: ConfigurableColumn<RecordType>,
  index: number,
  path: number[],
): string {
  if (column.key !== undefined && column.key !== null) return String(column.key);

  const dataIndex = column.dataIndex as unknown;
  if (Array.isArray(dataIndex)) return dataIndex.map(String).join('.');
  if (typeof dataIndex === 'string' || typeof dataIndex === 'number') return String(dataIndex);

  const titleText = getTitleText(column.title);
  if (titleText) return `title:${titleText}`;

  return `column:${[...path, index].join('.')}`;
}

function isAlwaysVisibleColumn<RecordType extends TableRecord>(
  column: ConfigurableColumn<RecordType>,
  key: string,
  alwaysVisibleKeys: Set<string>,
): boolean {
  const titleText = getTitleText(column.title);
  return alwaysVisibleKeys.has(key.toLowerCase()) || (!!titleText && DEFAULT_ALWAYS_VISIBLE_TITLES.includes(titleText));
}

function getColumnLabel<RecordType extends TableRecord>(
  column: ConfigurableColumn<RecordType>,
  key: string,
): string {
  const titleText = getTitleText(column.title);
  if (titleText) return titleText;

  const dataIndex = column.dataIndex as unknown;
  if (Array.isArray(dataIndex)) return dataIndex.map(String).join('.');
  if (typeof dataIndex === 'string' || typeof dataIndex === 'number') return String(dataIndex);

  return key.replace(/^title:/, '').replace(/^column:/, '列 ');
}

function collectColumnOptions<RecordType extends TableRecord>(
  columns: ConfigurableColumn<RecordType>[],
  alwaysVisibleKeys: Set<string>,
  path: number[] = [],
): ColumnOption[] {
  return columns.flatMap((column, index) => {
    const key = getColumnKey(column, index, path);
    const children = column.children ?? [];
    if (children.length > 0) return collectColumnOptions(children, alwaysVisibleKeys, [...path, index]);

    return [{
      key,
      title: getColumnLabel(column, key),
      alwaysVisible: isAlwaysVisibleColumn(column, key, alwaysVisibleKeys),
    }];
  });
}

function filterColumns<RecordType extends TableRecord>(
  columns: ConfigurableColumn<RecordType>[],
  hiddenKeys: Set<string>,
  alwaysVisibleKeys: Set<string>,
  path: number[] = [],
): ColumnProps<RecordType>[] {
  return columns.flatMap((column, index) => {
    const key = getColumnKey(column, index, path);
    const children = column.children ?? [];

    if (children.length > 0) {
      const visibleChildren = filterColumns(children, hiddenKeys, alwaysVisibleKeys, [...path, index]);
      if (visibleChildren.length === 0) return [];
      return [{ ...column, children: visibleChildren }];
    }

    if (hiddenKeys.has(key) && !isAlwaysVisibleColumn(column, key, alwaysVisibleKeys)) return [];
    return [column];
  });
}

function getDefaultStorageKey(columnKeys: string[]): string {
  const pathname = typeof window === 'undefined' ? 'ssr' : window.location.pathname;
  return `zenith:table-columns:${pathname}:${columnKeys.join('|')}`;
}

function readHiddenKeys(storageKey: string): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function writeHiddenKeys(storageKey: string, hiddenKeys: string[]) {
  if (typeof window === 'undefined') return;

  try {
    if (hiddenKeys.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(hiddenKeys));
  } catch {
    // localStorage may be unavailable in private mode; table rendering should not fail.
  }
}

export function ConfigurableTable<RecordType extends TableRecord = TableRecord>({
  columns,
  columnSettings = true,
  columnSettingsKey,
  alwaysVisibleColumnKeys = [],
  columnSettingsLabel = '列设置',
  pending,
  ...tableProps
}: ConfigurableTableProps<RecordType>) {
  const { preferences } = usePreferences();
  const effectiveColumnSettings = (preferences.showTableColumnSettings ?? true) && columnSettings;
  const rawColumns = useMemo(() => (columns ?? []) as ConfigurableColumn<RecordType>[], [columns]);
  const alwaysVisibleKeys = useMemo(
    () => new Set([...DEFAULT_ALWAYS_VISIBLE_KEYS, ...alwaysVisibleColumnKeys].map((key) => key.toLowerCase())),
    [alwaysVisibleColumnKeys],
  );
  const columnOptions = useMemo(
    () => collectColumnOptions(rawColumns, alwaysVisibleKeys),
    [rawColumns, alwaysVisibleKeys],
  );
  const storageKey = useMemo(
    () => columnSettingsKey ?? getDefaultStorageKey(columnOptions.map((option) => option.key)),
    [columnOptions, columnSettingsKey],
  );
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(() => readHiddenKeys(storageKey));

  useEffect(() => {
    setHiddenKeys(readHiddenKeys(storageKey));
  }, [storageKey]);

  const updateHiddenKeys = useCallback((updater: (prev: string[]) => string[]) => {
    setHiddenKeys((prev) => {
      const next = updater(prev);
      writeHiddenKeys(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const configurableOptions = useMemo(
    () => columnOptions.filter((option) => !option.alwaysVisible),
    [columnOptions],
  );
  const hiddenKeySet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const visibleColumns = useMemo(
    () => filterColumns(rawColumns, hiddenKeySet, alwaysVisibleKeys),
    [rawColumns, hiddenKeySet, alwaysVisibleKeys],
  );

  const settingsPanel = (
    <div className="column-settings-popover" onClick={(event) => event.stopPropagation()}>
      <div className="column-settings-title">列表列配置</div>
      <Space vertical align="start" className="column-settings-list">
        {configurableOptions.map((option) => (
          <Checkbox
            key={option.key}
            checked={!hiddenKeySet.has(option.key)}
            onChange={(event) => {
              const checked = !!(event.target as EventTarget & { checked?: boolean }).checked;
              updateHiddenKeys((prev) => (
                checked
                  ? prev.filter((key) => key !== option.key)
                  : Array.from(new Set([...prev, option.key]))
              ));
            }}
          >
            {option.title}
          </Checkbox>
        ))}
      </Space>
      <div className="column-settings-footer">
        <Button
          theme="borderless"
          size="small"
          icon={<RotateCcw size={14} />}
          onClick={() => updateHiddenKeys(() => [])}
        >
          恢复默认
        </Button>
      </div>
    </div>
  );

  return (
    <div className="configurable-table" style={pending ? { opacity: 0.6, transition: 'opacity 0.2s' } : undefined}>
      {effectiveColumnSettings && configurableOptions.length > 0 && (
        <div className="configurable-table-actions">
          <Dropdown trigger="click" render={settingsPanel}>
            <Button type="tertiary" theme="borderless" icon={<Settings2 size={14} />}>
              {columnSettingsLabel}
            </Button>
          </Dropdown>
        </div>
      )}
      <Table<RecordType> {...tableProps} columns={effectiveColumnSettings ? visibleColumns : columns} />
    </div>
  );
}

export default ConfigurableTable;

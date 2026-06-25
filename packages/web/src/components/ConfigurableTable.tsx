import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Button, Checkbox, Dropdown, Radio, RadioGroup, Space, Switch, Table } from '@douyinfe/semi-ui';
import { RotateCcw, Rows3, Settings, Settings2, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import type { ColumnProps, Data, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TableSizePreference } from '@/hooks/usePreferences';
import { ZENITH_OPERATION_COLUMN_SYMBOL, type ZenithOperationColumnMarker } from './table-column-meta';

type TableRecord = Data;
type ConfigurableColumn<RecordType extends TableRecord> = ColumnProps<RecordType> & {
  children?: ConfigurableColumn<RecordType>[];
} & ZenithOperationColumnMarker;

interface ColumnOption {
  key: string;
  title: string;
  alwaysVisible: boolean;
}

interface TableDisplaySettings {
  bordered?: boolean;
  striped?: boolean;
  size?: TableSizePreference;
}

function readTableDisplaySettings(key: string): TableDisplaySettings {
  if (globalThis.window === undefined) return {};
  try {
    const raw = globalThis.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const settings = parsed as Record<string, unknown>;
    const result: TableDisplaySettings = {};
    if ('bordered' in settings && typeof settings.bordered === 'boolean') result.bordered = settings.bordered;
    if ('striped' in settings && typeof settings.striped === 'boolean') result.striped = settings.striped;
    if ('size' in settings && typeof settings.size === 'string') result.size = settings.size as TableSizePreference;
    return result;
  } catch {
    return {};
  }
}

function writeTableDisplaySettings(key: string, settings: TableDisplaySettings) {
  if (globalThis.window === undefined) return;
  try {
    if (Object.keys(settings).length === 0) {
      globalThis.localStorage.removeItem(key);
      return;
    }
    globalThis.localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable in private mode
  }
}

interface ConfigurableTableProps<RecordType extends TableRecord = TableRecord> extends TableProps<RecordType> {
  columnSettings?: boolean;
  columnSettingsKey?: string;
  alwaysVisibleColumnKeys?: string[];
  columnSettingsLabel?: string;
  onRefresh?: () => void;
  refreshLoading?: boolean;
}

const DEFAULT_ALWAYS_VISIBLE_KEYS = ['action', 'actions', 'operation', 'operations', 'operate'];
const MOBILE_ACTION_COLUMN_WIDTH = 64;
const STRIPED_ROW_CLASS_NAME = 'configurable-table-row--striped';

function joinClassNames(...classNames: Array<string | false | null | undefined>): string | undefined {
  const next = classNames.filter(Boolean).join(' ');
  return next || undefined;
}

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
  return alwaysVisibleKeys.has(key.toLowerCase()) || isOperationColumn(column);
}

function isOperationColumn<RecordType extends TableRecord>(column: ConfigurableColumn<RecordType>): boolean {
  return column[ZENITH_OPERATION_COLUMN_SYMBOL] === true;
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
  compactActionColumn = false,
  path: number[] = [],
): ColumnProps<RecordType>[] {
  return columns.flatMap((column, index) => {
    const key = getColumnKey(column, index, path);
    const children = column.children ?? [];

    if (children.length > 0) {
      const visibleChildren = filterColumns(children, hiddenKeys, alwaysVisibleKeys, compactActionColumn, [...path, index]);
      if (visibleChildren.length === 0) return [];
      return [{ ...column, children: visibleChildren }];
    }

    if (hiddenKeys.has(key) && !isAlwaysVisibleColumn(column, key, alwaysVisibleKeys)) return [];
    if (compactActionColumn && isOperationColumn(column)) {
      return [{
        ...column,
        width: MOBILE_ACTION_COLUMN_WIDTH,
      }];
    }
    return [column];
  });
}

function getDefaultStorageKey(columnKeys: string[]): string {
  const pathname = globalThis.window === undefined ? 'ssr' : globalThis.window.location.pathname;
  return `zenith:table-columns:${pathname}:${columnKeys.join('|')}`;
}

function readHiddenKeys(storageKey: string): string[] {
  if (globalThis.window === undefined) return [];

  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function writeHiddenKeys(storageKey: string, hiddenKeys: string[]) {
  if (globalThis.window === undefined) return;

  try {
    if (hiddenKeys.length === 0) {
      globalThis.localStorage.removeItem(storageKey);
      return;
    }
    globalThis.localStorage.setItem(storageKey, JSON.stringify(hiddenKeys));
  } catch {
    // localStorage may be unavailable in private mode; table rendering should not fail.
  }
}

function removeHiddenKey(prev: string[], key: string): string[] {
  return prev.filter((k) => k !== key);
}

function addHiddenKey(prev: string[], key: string): string[] {
  return Array.from(new Set([...prev, key]));
}

export function ConfigurableTable<RecordType extends TableRecord = TableRecord>({
  columns,
  columnSettings = true,
  columnSettingsKey,
  alwaysVisibleColumnKeys = [],
  columnSettingsLabel = '列设置',
  onRefresh,
  refreshLoading = false,
  ...tableProps
}: Readonly<ConfigurableTableProps<RecordType>>) {
  const { preferences } = usePreferences();
  const isMobile = useIsMobile();
  const { bordered, className, onRow, size, pagination, ...restTableProps } = tableProps;

  const effectivePagination = useMemo(() => {
    if (!pagination || typeof pagination === 'boolean') return pagination;
    // 移动端紧凑分页：隐藏每页条数选择器与总数文案、使用小尺寸；页面显式传入的分页配置仍可覆盖
    const defaults = isMobile
      ? { showTotal: false, showSizeChanger: false, size: 'small' as const, pageSizeOpts: [10, 20, 50, 100] }
      : { showTotal: true, showSizeChanger: true, pageSizeOpts: [10, 20, 50, 100] };
    return { ...defaults, ...pagination };
  }, [pagination, isMobile]);
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
  const tableDisplayKey = useMemo(() => `${storageKey}:display`, [storageKey]);

  const [hiddenKeys, setHiddenKeys] = useState<string[]>(() => readHiddenKeys(storageKey));
  const [tableSettings, setTableSettings] = useState<TableDisplaySettings>(() => readTableDisplaySettings(tableDisplayKey));
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Esc 键退出全屏
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  useEffect(() => {
    setHiddenKeys(readHiddenKeys(storageKey));
  }, [storageKey]);

  useEffect(() => {
    setTableSettings(readTableDisplaySettings(tableDisplayKey));
  }, [tableDisplayKey]);

  const effectiveBordered = tableSettings.bordered ?? preferences.tableBordered ?? bordered;
  const effectiveStriped = tableSettings.striped ?? preferences.tableStriped ?? false;
  const effectiveSize = tableSettings.size ?? preferences.tableSize ?? size;

  const updateHiddenKeys = useCallback((updater: (prev: string[]) => string[]) => {
    setHiddenKeys((prev) => {
      const next = updater(prev);
      writeHiddenKeys(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const updateTableSettings = useCallback((partial: Partial<TableDisplaySettings>) => {
    setTableSettings((prev) => {
      const next = { ...prev, ...partial };
      writeTableDisplaySettings(tableDisplayKey, next);
      return next;
    });
  }, [tableDisplayKey]);

  const configurableOptions = useMemo(
    () => columnOptions.filter((option) => !option.alwaysVisible),
    [columnOptions],
  );
  const hiddenKeySet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const visibleColumns = useMemo(
    () => filterColumns(rawColumns, hiddenKeySet, alwaysVisibleKeys, isMobile),
    [rawColumns, hiddenKeySet, alwaysVisibleKeys, isMobile],
  );
  const responsiveColumns = useMemo(
    () => filterColumns(rawColumns, new Set<string>(), alwaysVisibleKeys, isMobile),
    [rawColumns, alwaysVisibleKeys, isMobile],
  );
  const effectiveOnRow = useMemo<TableProps<RecordType>['onRow']>(() => {
    if (!effectiveStriped) return onRow;

    return (record, index, rowStatus) => {
      const rowProps = onRow?.(record, index, rowStatus) ?? {};
      if (index === undefined || index % 2 !== 0) return rowProps;

      return {
        ...rowProps,
        className: joinClassNames(rowProps.className, STRIPED_ROW_CLASS_NAME),
      };
    };
  }, [effectiveStriped, onRow]);
  const tableClassName = joinClassNames(className, effectiveStriped && 'configurable-table__table--striped');
  const effectiveColumns = effectiveColumnSettings ? visibleColumns : responsiveColumns;

  const handleResetColumns = useCallback(() => {
    updateHiddenKeys(() => []);
  }, [updateHiddenKeys]);

  const handleResetDisplaySettings = useCallback(() => {
    setTableSettings({});
    writeTableDisplaySettings(tableDisplayKey, {});
  }, [tableDisplayKey]);

  const settingsPanel = (
    <div className="column-settings-popover">
      <div className="column-settings-title">列表列配置</div>
      <Space vertical align="start" className="column-settings-list">
        {configurableOptions.map((option) => (
          <Checkbox
            key={option.key}
            checked={!hiddenKeySet.has(option.key)}
            onChange={(event) => {
              const checked = !!(event.target as EventTarget & { checked?: boolean }).checked;
              updateHiddenKeys((prev) => checked ? removeHiddenKey(prev, option.key) : addHiddenKey(prev, option.key));
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
          onClick={handleResetColumns}
        >
          恢复默认
        </Button>
      </div>
    </div>
  );

  const sizePanelContent = (
    <div className="table-size-panel">
      <div className="table-size-panel-title">表格尺寸</div>
      <RadioGroup
        direction="vertical"
        value={effectiveSize ?? 'small'}
        onChange={(e) => updateTableSettings({ size: e.target.value as TableSizePreference })}
      >
        <Radio value="small">紧凑</Radio>
        <Radio value="middle">适中</Radio>
        <Radio value="default">宽松</Radio>
      </RadioGroup>
    </div>
  );

  const displaySettingsPanelContent = (
    <div className="table-display-settings-panel">
      <div className="table-display-settings-title">表格显示</div>
      <div className="table-display-settings-list">
        <div className="table-display-settings-item">
          <span>显示表格边框</span>
          <Switch size="small" checked={!!effectiveBordered} onChange={(checked) => updateTableSettings({ bordered: checked })} />
        </div>
        <div className="table-display-settings-item">
          <span>启用斑马纹</span>
          <Switch size="small" checked={!!effectiveStriped} onChange={(checked) => updateTableSettings({ striped: checked })} />
        </div>
      </div>
      <div className="table-display-settings-footer">
        <Button
          theme="borderless"
          size="small"
          icon={<RotateCcw size={14} />}
          onClick={handleResetDisplaySettings}
        >
          恢复默认
        </Button>
      </div>
    </div>
  );

  return (
    <div className={`configurable-table${isFullscreen ? ' configurable-table--fullscreen' : ''}`}>
      <div className="configurable-table-actions">
        {onRefresh && (
          <Button
            type="tertiary"
            theme="borderless"
            icon={<RefreshCw size={14} className={refreshLoading ? 'spin' : ''} />}
            aria-label="刷新"
            title="刷新"
            disabled={refreshLoading}
            onClick={() => onRefresh()}
          />
        )}
        {effectiveColumnSettings && configurableOptions.length > 0 && (
          <Dropdown trigger="click" render={settingsPanel}>
            <Button
              type="tertiary"
              theme="borderless"
              icon={<Settings2 size={14} />}
              aria-label={columnSettingsLabel}
              title={columnSettingsLabel}
            />
          </Dropdown>
        )}
        <Dropdown trigger="click" render={sizePanelContent}>
          <Button
            type="tertiary"
            theme="borderless"
            icon={<Rows3 size={14} />}
            aria-label="表格尺寸"
            title="表格尺寸"
          />
        </Dropdown>
        <Dropdown trigger="click" render={displaySettingsPanelContent}>
          <Button
            type="tertiary"
            theme="borderless"
            icon={<Settings size={14} />}
            aria-label="表格显示设置"
            title="表格显示设置"
          />
        </Dropdown>
        <Button
          type="tertiary"
          theme="borderless"
          icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          aria-label={isFullscreen ? '退出全屏' : '全屏展示'}
          title={isFullscreen ? '退出全屏（Esc）' : '全屏展示'}
          onClick={() => setIsFullscreen((v) => !v)}
        />
      </div>
      <Table<RecordType>
        {...restTableProps}
        bordered={effectiveBordered}
        className={tableClassName}
        columns={effectiveColumns}
        onRow={effectiveOnRow}
        pagination={effectivePagination}
        size={effectiveSize}
      />
    </div>
  );
}

export default ConfigurableTable;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { TABLE_PAGE_SIZE_OPTIONS } from '@/hooks/usePagination';
import { Button, Checkbox, Dropdown, Radio, RadioGroup, Space, Switch, Table } from '@douyinfe/semi-ui';
import { RotateCcw, Rows3, Settings, Settings2, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import type { ColumnProps, Data, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TableSizePreference } from '@/hooks/usePreferences';
import { ZENITH_OPERATION_COLUMN_SYMBOL, type ZenithOperationColumnMarker } from './table-column-meta';
import { resolveFlexColumns, stripFlexColumnProps, type FlexColumnProps } from './table-flex-columns';

type TableRecord = Data;
type ConfigurableColumn<RecordType extends TableRecord> = Omit<ColumnProps<RecordType>, 'children'> & {
  children?: ConfigurableColumn<RecordType>[];
  /** 弹性主列的最小宽度：不设 `width` 的列吸收剩余空间，容器过窄时保底该宽度（见 table-flex-columns.ts） */
  minWidth?: number;
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
  columnSettingsLabel?: string;
  onRefresh?: () => void;
  refreshLoading?: boolean;
}

const MOBILE_ACTION_COLUMN_WIDTH = 64;
const STRIPED_ROW_CLASS_NAME = 'configurable-table-row--striped';
/** 开发期每类布局问题对每个表格只提示一次，避免每次渲染重复告警 */
const devWarned = new Set<string>();

function warnDevOnce(key: string, message: string) {
  if (!import.meta.env.DEV || devWarned.has(key)) return;
  devWarned.add(key);
  console.warn(`[ConfigurableTable] ${message}`);
}

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
): boolean {
  return isOperationColumn(column);
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
  path: number[] = [],
): ColumnOption[] {
  return columns.flatMap((column, index) => {
    const key = getColumnKey(column, index, path);
    const children = column.children ?? [];
    if (children.length > 0) return collectColumnOptions(children, [...path, index]);

    return [{
      key,
      title: getColumnLabel(column, key),
      alwaysVisible: isAlwaysVisibleColumn(column),
    }];
  });
}

function filterColumns<RecordType extends TableRecord>(
  columns: ConfigurableColumn<RecordType>[],
  hiddenKeys: Set<string>,
  compactActionColumn = false,
  path: number[] = [],
): ColumnProps<RecordType>[] {
  return columns.reduce<ColumnProps<RecordType>[]>((result, column, index) => {
    const key = getColumnKey(column, index, path);
    const children = column.children ?? [];

    if (children.length > 0) {
      const visibleChildren = filterColumns(children, hiddenKeys, compactActionColumn, [...path, index]);
      if (visibleChildren.length > 0) result.push({ ...column, children: visibleChildren });
      return result;
    }

    if (hiddenKeys.has(key) && !isAlwaysVisibleColumn(column)) return result;
    if (compactActionColumn && isOperationColumn(column)) {
      result.push({
        ...column,
        width: MOBILE_ACTION_COLUMN_WIDTH,
      });
      return result;
    }
    result.push(column);
    return result;
  }, []);
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
  columnSettingsLabel = '列设置',
  onRefresh,
  refreshLoading = false,
  ...tableProps
}: Readonly<ConfigurableTableProps<RecordType>>) {
  const { preferences, canOverridePreference, canEditPreference } = usePreferences();
  const isMobile = useIsMobile();
  const {
    bordered, className, onRow, size, pagination,
    scroll, rowSelection, expandedRowRender, hideExpandedColumn, sticky, resizable, virtualized, components,
    ...restTableProps
  } = tableProps;
  const rootRef = useRef<HTMLDivElement>(null);

  // 虚拟化表格：Semi 把 scroll.x 直接写成 wrapper 宽度（不是最小宽度），要铺满容器就必须量出容器宽度；
  // body 行宽等于各列之和、纵向滚动条又占在 body 内部，所以各列之和要按 body 的可视宽度（clientWidth）给。
  // 记「容器宽 − body 可视宽」为 chrome（边框 + 滚动条），容器变化时直接用它推算可视宽，一次渲染到位；
  // body 观察器只在滚动条出现 / 消失时校正 chrome。
  const [virtualizedWrapperWidth, setVirtualizedWrapperWidth] = useState(0);
  const [virtualizedChrome, setVirtualizedChrome] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!virtualized || !el) return;
    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (width > 0) setVirtualizedWrapperWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [virtualized]);
  useEffect(() => {
    const root = rootRef.current;
    if (!virtualized || !root) return;
    // 每次都重新查 body：Semi 在 scroll / 数据变化时可能重建 body 元素，缓存引用会指向已卸载节点
    const measure = () => {
      const body = root.querySelector<HTMLElement>('.semi-table-body');
      if (!body) return;
      // 同值 setState 会被 React 忽略；只有滚动条出现 / 消失（或边框变化）时才触发第二次渲染
      setVirtualizedChrome(Math.max(0, Math.floor(root.getBoundingClientRect().width) - body.clientWidth));
    };
    measure();
    // 纵向滚动条随虚拟列表内容高度出现 / 消失，body 自身盒子尺寸不变、ResizeObserver 不会触发，
    // 靠子树变更（行渲染 / 数据到达 / body 重建）驱动重新度量，按帧节流
    let frame = 0;
    const mutationObserver = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    });
    mutationObserver.observe(root, { childList: true, subtree: true });
    return () => {
      mutationObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [virtualized, restTableProps.dataSource, restTableProps.expandedRowKeys, scroll?.y]);

  // 虚拟化表格的表头 table：Semi 写成 scroll.x（= wrapper）宽，而 body 行宽是各列之和，纵向滚动条占位使两者不等，
  // 表头列会被按比例拉伸而与行错位。经 components.header.outer 把表头 table 宽度改成各列之和即可对齐。
  const headerTableWidthRef = useRef(0);
  const VirtualizedHeaderTable = useMemo(() => {
    function HeaderTable({ style, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
      const width = headerTableWidthRef.current;
      return <table {...rest} style={width > 0 ? { ...style, width } : style} />;
    }
    return HeaderTable;
  }, []);
  const effectiveComponents = useMemo<TableProps<RecordType>['components']>(() => {
    if (!virtualized) return components;
    return { ...components, header: { ...components?.header, outer: VirtualizedHeaderTable } };
  }, [components, virtualized, VirtualizedHeaderTable]);

  const effectivePagination = useMemo(() => {
    if (!pagination || typeof pagination === 'boolean') return pagination;
    // 移动端紧凑分页：隐藏每页条数选择器与总数文案、使用小尺寸；页面显式传入的分页配置仍可覆盖
    const defaults = isMobile
      ? { showTotal: false, showSizeChanger: false, size: 'small' as const, pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS }
      : { showTotal: true, showSizeChanger: true, pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS };
    return { ...defaults, ...pagination };
  }, [pagination, isMobile]);
  const effectiveColumnSettings = (preferences.showTableColumnSettings ?? true) && columnSettings;
  const rawColumns = useMemo(() => (columns ?? []) as ConfigurableColumn<RecordType>[], [columns]);
  const columnOptions = useMemo(
    () => collectColumnOptions(rawColumns),
    [rawColumns],
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

  const effectiveBordered = canOverridePreference('tableBordered') ? tableSettings.bordered ?? preferences.tableBordered ?? bordered : preferences.tableBordered;
  const effectiveStriped = canOverridePreference('tableStriped') ? tableSettings.striped ?? preferences.tableStriped ?? false : preferences.tableStriped;
  const effectiveSize = canOverridePreference('tableSize') ? tableSettings.size ?? preferences.tableSize ?? size : preferences.tableSize;

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
    () => filterColumns(rawColumns, hiddenKeySet, isMobile),
    [rawColumns, hiddenKeySet, isMobile],
  );
  const responsiveColumns = useMemo(
    () => filterColumns(rawColumns, new Set<string>(), isMobile),
    [rawColumns, isMobile],
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

  // 弹性主列：按当前可见列求和写入 scroll.x，防止 fixed 布局下操作列被按比例拉宽；
  // 列宽由用户拖拽（resizable）时 Semi 自行管理宽度，只剥离 minWidth 不介入
  const resolvedLayout = useMemo(() => {
    const flexColumns = effectiveColumns as FlexColumnProps<RecordType>[];
    if (resizable) return { columns: stripFlexColumnProps(flexColumns), scroll, fallbackColumnLabel: null, columnsTotalWidth: 0, ignoredScrollX: false };
    // 首次渲染 chrome 尚未量到时先按整个 wrapper 宽度铺，body 观察器量到后再校正
    const fill = virtualized && virtualizedWrapperWidth > 0
      ? { wrapperWidth: virtualizedWrapperWidth, contentWidth: Math.max(0, virtualizedWrapperWidth - virtualizedChrome) }
      : undefined;
    return resolveFlexColumns(flexColumns, { scroll, rowSelection, expandedRowRender, hideExpandedColumn, sticky, fill });
  }, [effectiveColumns, scroll, rowSelection, expandedRowRender, hideExpandedColumn, sticky, resizable, virtualized, virtualizedWrapperWidth, virtualizedChrome]);
  // 表头 table 在同一次渲染里读取该值（Semi 会随 columns 变化重渲染表头）
  headerTableWidthRef.current = virtualized && !resizable ? resolvedLayout.columnsTotalWidth : 0;

  useEffect(() => {
    if (resolvedLayout.fallbackColumnLabel) {
      warnDevOnce(`${storageKey}:fallback`, `${storageKey}\n所有列都设置了固定宽度，已自动放开「${resolvedLayout.fallbackColumnLabel}」列吸收剩余空间。`
        + '请为主列去掉 width、改用 minWidth 显式声明弹性列（constraints-frontend.md → 搜索栏与表格）。');
    }
    if (resolvedLayout.ignoredScrollX) {
      warnDevOnce(`${storageKey}:scroll-x`, `${storageKey}\nscroll.x 由各列宽度之和自动推导，页面传入的 scroll.x 已被忽略，请删除。`);
    }
  }, [resolvedLayout.fallbackColumnLabel, resolvedLayout.ignoredScrollX, storageKey]);

  // 开发期校验操作列宽度：单元格无 overflow: hidden，内容超宽不会报错也不会截断，而是吃掉 padding 并挤压相邻固定列
  useEffect(() => {
    if (!import.meta.env.DEV || isMobile) return;
    const root = rootRef.current;
    if (!root) return;
    let widest = 0;
    let cellInner = 0;
    for (const actions of root.querySelectorAll<HTMLElement>('.semi-table-tbody .responsive-table-actions')) {
      // 按钮 loading 态会临时插入 spinner 加宽内容，不作为判定依据
      if (actions.querySelector('.semi-button-loading')) continue;
      const cell = actions.closest<HTMLElement>('.semi-table-row-cell');
      if (!cell) continue;
      const style = getComputedStyle(cell);
      cellInner = cell.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      widest = Math.max(widest, actions.getBoundingClientRect().width);
    }
    if (widest > cellInner && cellInner > 0) {
      warnDevOnce(`${storageKey}:operation-overflow:${Math.round(widest)}`, `${storageKey}\n操作列内容宽 ${Math.round(widest)}px 超过列内可用宽 ${Math.round(cellInner)}px，`
        + '请按 ui-patterns.md → 操作列 的公式复核 width，或用 desktopInlineKeys 收纳低频动作。');
    }
  }, [restTableProps.dataSource, resolvedLayout.columns, storageKey, isMobile]);

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
        {canEditPreference('tableBordered') && <div className="table-display-settings-item">
          <span>显示表格边框</span>
          <Switch size="small" checked={!!effectiveBordered} onChange={(checked) => updateTableSettings({ bordered: checked })} />
        </div>}
        {canEditPreference('tableStriped') && <div className="table-display-settings-item">
          <span>启用斑马纹</span>
          <Switch size="small" checked={!!effectiveStriped} onChange={(checked) => updateTableSettings({ striped: checked })} />
        </div>}
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
    <div ref={rootRef} className={`configurable-table${isFullscreen ? ' configurable-table--fullscreen' : ''}`}>
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
        {canEditPreference('tableSize') && <Dropdown trigger="click" render={sizePanelContent}>
          <Button
            type="tertiary"
            theme="borderless"
            icon={<Rows3 size={14} />}
            aria-label="表格尺寸"
            title="表格尺寸"
          />
        </Dropdown>}
        {(canEditPreference('tableBordered') || canEditPreference('tableStriped')) && <Dropdown trigger="click" render={displaySettingsPanelContent}>
          <Button
            type="tertiary"
            theme="borderless"
            icon={<Settings size={14} />}
            aria-label="表格显示设置"
            title="表格显示设置"
          />
        </Dropdown>}
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
        columns={resolvedLayout.columns}
        scroll={resolvedLayout.scroll}
        rowSelection={rowSelection}
        expandedRowRender={expandedRowRender}
        hideExpandedColumn={hideExpandedColumn}
        sticky={sticky}
        resizable={resizable}
        virtualized={virtualized}
        components={effectiveComponents}
        onRow={effectiveOnRow}
        pagination={effectivePagination}
        size={effectiveSize}
      />
    </div>
  );
}

export default ConfigurableTable;

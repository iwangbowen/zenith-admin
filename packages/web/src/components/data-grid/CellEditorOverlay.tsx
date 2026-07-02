import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, DatePicker, Input, Select, Space, TextArea, TimePicker, Typography } from '@douyinfe/semi-ui';

import type { DataGridColumn } from './types';
import type { CellKind } from './grid-format';
import { coerceCellInput, editorTextForValue, normalizeSmartQuotes } from './cell-coercion';
import { formatDateTimeForApi, formatDateForApi } from '@/utils/date';

const { Text } = Typography;

export type CommitMove = 'down' | 'right' | 'none';

export interface CellEditorOverlayProps {
  column: DataGridColumn;
  kind: CellKind;
  /** 当前有效值（含既有暂存） */
  value: unknown;
  /** 相对 dg-body 的定位矩形 */
  rect: { left: number; top: number; width: number; height: number };
  /** 打字直接进入编辑时的初始字符（替换原文本） */
  initialText?: string;
  onCommit: (value: unknown, move: CommitMove) => void;
  onCancel: () => void;
}

const NULL_SENTINEL = '\u0000__NULL__';

function isLongText(value: unknown): boolean {
  return typeof value === 'string' && (value.length > 120 || value.includes('\n'));
}

/**
 * 内联单元格编辑覆盖层：按列类型分派编辑器（借鉴 dbx：枚举/日期时间/布尔/JSON/文本）。
 * 字符串态编辑 + 提交时 coerce；校验失败保持编辑态并提示。
 */
export function CellEditorOverlay(props: CellEditorOverlayProps) {
  const { column, kind, value, rect, initialText, onCommit, onCancel } = props;
  const nullable = column.nullable !== false;
  const committedRef = useRef(false);

  const commitOnce = (v: unknown, move: CommitMove) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(v, move);
  };
  const cancelOnce = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    minWidth: Math.max(rect.width, 160),
    width: Math.max(rect.width, 160),
    zIndex: 4,
  };

  const stop = {
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
  };

  // ── 枚举 / 布尔：下拉选择 ──
  if ((column.enumValues && column.enumValues.length > 0) || kind === 'bool') {
    const options = column.enumValues && column.enumValues.length > 0
      ? column.enumValues.map((v) => ({ label: v, value: v }))
      : [{ label: 'true', value: 'true' }, { label: 'false', value: 'false' }];
    if (nullable) options.unshift({ label: '(NULL)', value: NULL_SENTINEL });
    let current: string;
    if (value === null || value === undefined) current = NULL_SENTINEL;
    else if (typeof value === 'boolean') current = value ? 'true' : 'false';
    else current = String(value);
    const handleSelect = (v: unknown) => {
      const s = String(v);
      if (s === NULL_SENTINEL) {
        commitOnce(null, 'none');
      } else if (kind === 'bool' && !column.enumValues?.length) {
        commitOnce(s === 'true', 'none');
      } else {
        commitOnce(s, 'none');
      }
    };
    return (
      <div style={baseStyle} {...stop} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelOnce(); } }}>
        <Select
          size="small"
          autoFocus
          defaultOpen
          value={current}
          optionList={options}
          style={{ width: '100%' }}
          onChange={handleSelect}
          onBlur={() => { if (!committedRef.current) cancelOnce(); }}
        />
      </div>
    );
  }

  // ── 日期 / 时间：选择器 ──
  if (kind === 'datetime' || kind === 'date') {
    return (
      <TemporalEditor
        kind={kind}
        column={column}
        value={value}
        style={baseStyle}
        stop={stop}
        nullable={nullable}
        onCommit={commitOnce}
        onCancel={cancelOnce}
      />
    );
  }

  if (kind === 'time') {
    return (
      <div style={baseStyle} {...stop} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelOnce(); } }}>
        <TimePicker
          size="small"
          autoFocus
          open
          format="HH:mm:ss"
          defaultValue={typeof value === 'string' ? value : undefined}
          motion={false}
          style={{ width: '100%' }}
          onChange={(_t, ts) => { if (typeof ts === 'string' && ts) commitOnce(ts, 'none'); }}
        />
      </div>
    );
  }

  // ── JSON / 长文本：多行面板 ──
  if (kind === 'json' || isLongText(value)) {
    return (
      <MultilineEditor
        kind={kind}
        column={column}
        value={value}
        initialText={initialText}
        style={{ ...baseStyle, width: Math.max(rect.width, 360) }}
        stop={stop}
        nullable={nullable}
        onCommit={commitOnce}
        onCancel={cancelOnce}
      />
    );
  }

  // ── 默认：单行文本 / 数字 ──
  return (
    <SingleLineEditor
      kind={kind}
      column={column}
      value={value}
      initialText={initialText}
      style={baseStyle}
      stop={stop}
      nullable={nullable}
      onCommit={commitOnce}
      onCancel={cancelOnce}
    />
  );
}

interface InnerEditorProps {
  kind: CellKind;
  column: DataGridColumn;
  value: unknown;
  initialText?: string;
  style: React.CSSProperties;
  stop: Record<string, (e: React.MouseEvent) => void>;
  nullable: boolean;
  onCommit: (value: unknown, move: CommitMove) => void;
  onCancel: () => void;
}

/** 日期 / 日期时间编辑器：DatePicker + 「此刻」快捷键（借鉴 dbx TemporalCellEditor 的 Now 按钮） */
function TemporalEditor(props: InnerEditorProps) {
  const { kind, value, style, stop, nullable, onCommit, onCancel } = props;
  const isDateTime = kind === 'datetime';
  const [picked, setPicked] = useState<Date | string | undefined>(() => {
    if (typeof value === 'string' && value) return value.replace('T', ' ');
    return undefined;
  });

  const commitPicked = (v: Date | string | undefined) => {
    if (v === undefined) { onCancel(); return; }
    onCommit(isDateTime ? formatDateTimeForApi(v) : formatDateForApi(v), 'none');
  };

  return (
    <div style={style} className="dg-editor-panel" {...stop} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <DatePicker
        size="small"
        autoFocus
        type={isDateTime ? 'dateTime' : 'date'}
        format={isDateTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd'}
        defaultValue={picked}
        defaultOpen
        motion={false}
        showClear={nullable}
        style={{ width: '100%' }}
        onChange={(d) => {
          if (d === null || d === undefined) {
            setPicked(undefined);
            return;
          }
          const dateVal = (Array.isArray(d) ? d[0] : d) as Date | string;
          setPicked(dateVal);
          if (!isDateTime) onCommit(formatDateForApi(dateVal), 'none');
        }}
        onClear={() => { if (nullable) onCommit(null, 'none'); }}
      />
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <Button size="small" theme="borderless" onClick={() => onCommit(isDateTime ? formatDateTimeForApi(new Date()) : formatDateForApi(new Date()), 'none')}>此刻</Button>
        <Space>
          <Button size="small" onClick={onCancel}>取消</Button>
          {isDateTime && (
            <Button size="small" theme="solid" type="primary" onClick={() => commitPicked(picked)}>确认</Button>
          )}
        </Space>
      </div>
    </div>
  );
}

function SingleLineEditor(props: InnerEditorProps) {
  const { kind, value, initialText, style, stop, nullable, onCommit, onCancel } = props;
  const [text, setText] = useState(initialText ?? editorTextForValue(value, kind));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      if (!initialText) inputRef.current?.select();
    }, 20);
    return () => clearTimeout(t);
  }, [initialText]);

  const tryCommit = (move: CommitMove) => {
    const result = coerceCellInput(text, { kind, original: value, nullable });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCommit(result.value, move);
  };

  return (
    <div style={style} {...stop}>
      <Input
        size="small"
        ref={inputRef as never}
        value={text}
        onChange={(v: string) => { setText(v); setError(null); }}
        validateStatus={error ? 'error' : 'default'}
        style={{ width: '100%', background: 'var(--semi-color-bg-2)' }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter') { e.preventDefault(); tryCommit('down'); }
          else if (e.key === 'Tab') { e.preventDefault(); tryCommit('right'); }
          else if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        }}
        onBlur={() => tryCommit('none')}
      />
      {error && (
        <div className="dg-editor-error">
          <Text type="danger" size="small">{error}</Text>
        </div>
      )}
    </div>
  );
}

function MultilineEditor(props: InnerEditorProps) {
  const { kind, value, initialText, style, stop, nullable, onCommit, onCancel } = props;
  const [text, setText] = useState(initialText ?? editorTextForValue(value, kind));
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => areaRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  const jsonError = useMemo<string | null>(() => {
    if (kind !== 'json') return null;
    const s = text.trim();
    if (s === '' || s.toUpperCase() === 'NULL') return null;
    try {
      JSON.parse(normalizeSmartQuotes(s));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'JSON 解析失败';
    }
  }, [kind, text]);

  const tryCommit = () => {
    const result = coerceCellInput(text, { kind, original: value, nullable });
    if (!result.ok) return;
    onCommit(result.value, 'none');
  };

  return (
    <div style={style} className="dg-editor-panel" {...stop}>
      <TextArea
        ref={areaRef as never}
        value={text}
        onChange={(v: string) => setText(v)}
        autosize={{ minRows: 3, maxRows: 12 }}
        placeholder={kind === 'json' ? '{ "key": "value" }（输入 NULL 置空）' : '输入 NULL 置空'}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); tryCommit(); }
          else if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        }}
      />
      {jsonError && (
        <Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
          JSON 错误：{jsonError}
        </Text>
      )}
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="tertiary" size="small">Ctrl+Enter 确认</Text>
        <Space>
          <Button size="small" onClick={onCancel}>取消</Button>
          <Button size="small" theme="solid" type="primary" disabled={Boolean(jsonError)} onClick={tryCommit}>确认</Button>
        </Space>
      </div>
    </div>
  );
}

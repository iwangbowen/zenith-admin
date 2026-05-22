import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import {
  Input,
  TextArea,
  InputNumber,
  Switch,
  Popover,
  Dropdown,
  Button,
  Space,
  Spin,
  Tooltip,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';

import { request } from '@/utils/request';

import './db-admin.css';
import { buildUpdateSql, copyToClipboard } from './sql-format';

const { Text } = Typography;

type Kind = 'bool' | 'int' | 'number' | 'json' | 'text' | 'long-text';

function fieldKind(dataType?: string): Kind {
  if (!dataType) return 'text';
  const t = dataType.toLowerCase();
  if (t === 'boolean') return 'bool';
  if (/^(small|big)?int|^integer$/.test(t)) return 'int';
  if (/numeric|decimal|real|double/.test(t)) return 'number';
  if (/jsonb?$/.test(t)) return 'json';
  if (/text$|character varying|array|\[\]/.test(t)) return 'long-text';
  return 'text';
}

function formatDisplay(v: unknown): JSX.Element | string {
  if (v == null) return <Text type="quaternary">NULL</Text>;
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return <Text code>{s.length > 80 ? s.slice(0, 80) + '…' : s}</Text>;
  }
  let str: string;
  if (typeof v === 'string') str = v;
  else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') str = v.toString();
  else str = JSON.stringify(v);
  if (str.length > 80) {
    return (
      <Tooltip content={<div style={{ maxWidth: 400, wordBreak: 'break-all' }}>{str}</div>}>
        {str.slice(0, 80) + '…'}
      </Tooltip>
    );
  }
  return str;
}

interface Props {
  value: unknown;
  columnName: string;
  dataType?: string;
  schema: string;
  table: string;
  primaryKey: string[];
  record: Record<string, unknown>;
  readOnly?: boolean;
  onSaved: (newValue: unknown) => void;
}

function toEditValue(raw: unknown, kind: Kind): string | number | boolean | null {
  if (raw === null || raw === undefined) return kind === 'bool' ? false : '';
  if (kind === 'bool') return Boolean(raw);
  if (kind === 'int' || kind === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isNaN(n) ? '' : n;
  }
  if (kind === 'json' && typeof raw === 'object') return JSON.stringify(raw, null, 2);
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') return raw.toString();
  return JSON.stringify(raw);
}

function toApiValue(v: unknown, kind: Kind): unknown {
  if (v === '' || v === undefined) return null;
  if (kind === 'json' && typeof v === 'string') {
    return JSON.parse(v);
  }
  return v;
}

function valueDisplayForCopy(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface ContextMenuProps {
  value: unknown;
  schema: string;
  table: string;
  columnName: string;
  pk: Record<string, unknown> | null;
  readOnly: boolean;
  onSetNull: () => void;
  children: JSX.Element;
}

function CellContextMenu({
  value, schema, table, columnName, pk, readOnly, onSetNull, children,
}: Readonly<ContextMenuProps>): JSX.Element {
  const handleCopyValue = async () => {
    const ok = await copyToClipboard(valueDisplayForCopy(value));
    if (ok) Toast.success('已复制值');
    else Toast.warning('复制失败');
  };

  const handleCopyUpdateSql = async () => {
    if (!pk) {
      Toast.warning('无主键，无法生成 UPDATE SQL');
      return;
    }
    const sql = buildUpdateSql(schema, table, pk, { [columnName]: value });
    const ok = await copyToClipboard(sql);
    if (ok) Toast.success('已复制 UPDATE SQL');
    else Toast.warning('复制失败');
  };

  const menu = (
    <Dropdown.Menu>
      <Dropdown.Item onClick={() => void handleCopyValue()}>复制值</Dropdown.Item>
      {!readOnly && (
        <Dropdown.Item onClick={onSetNull} disabled={value === null || value === undefined}>
          设为 NULL
        </Dropdown.Item>
      )}
      <Dropdown.Divider />
      <Dropdown.Item onClick={() => void handleCopyUpdateSql()} disabled={!pk}>
        复制为 UPDATE SQL
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <Dropdown trigger="contextMenu" position="bottomLeft" render={menu}>
      {children}
    </Dropdown>
  );
}

export function EditableCell(props: Readonly<Props>): JSX.Element {
  const { value, columnName, dataType, schema, table, primaryKey, record, readOnly, onSaved } = props;
  const kind = fieldKind(dataType);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | number | boolean | null>(toEditValue(value, kind));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    if (editing) {
      setDraft(toEditValue(value, kind));
      savedRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [editing, value, kind]);

  const pk = useMemo<Record<string, unknown> | null>(() => {
    if (primaryKey.length === 0) return null;
    const out: Record<string, unknown> = {};
    for (const k of primaryKey) out[k] = record[k];
    return out;
  }, [primaryKey, record]);

  const jsonError = useMemo<string | null>(() => {
    if (!editing || kind !== 'json') return null;
    const s = String(draft ?? '').trim();
    if (s === '') return null;
    try {
      JSON.parse(s);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'JSON 解析失败';
    }
  }, [editing, kind, draft]);

  const save = async (overrideValue?: unknown) => {
    if (savedRef.current) return;
    if (!pk) {
      Toast.warning('无主键，无法保存');
      return;
    }
    let next: unknown;
    if (overrideValue === undefined) {
      try {
        next = toApiValue(draft, kind);
      } catch {
        Toast.error('JSON 格式错误，请检查');
        return;
      }
    } else {
      next = overrideValue;
    }
    let prev: unknown;
    try {
      prev = toApiValue(toEditValue(value, kind), kind);
    } catch {
      prev = value;
    }
    if (JSON.stringify(next) === JSON.stringify(prev)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await request.patch<{ updated: number }>(
        `/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows`,
        { pk, changes: { [columnName]: next } },
      );
      if (res.code === 0) {
        savedRef.current = true;
        Toast.success('已保存');
        setEditing(false);
        onSaved(next);
      }
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    savedRef.current = true;
    setEditing(false);
  };

  const handleSetNull = () => { void save(null); };

  const wrapWithMenu = (child: JSX.Element) => (
    <CellContextMenu
      value={value}
      schema={schema}
      table={table}
      columnName={columnName}
      pk={pk}
      readOnly={Boolean(readOnly)}
      onSetNull={handleSetNull}
    >
      {child}
    </CellContextMenu>
  );

  if (readOnly) {
    return wrapWithMenu(
      <span style={{ color: 'var(--semi-color-text-2)' }}>{formatDisplay(value)}</span>,
    );
  }

  if (kind === 'bool') {
    return wrapWithMenu(
      <span>
        <Switch
          size="small"
          loading={saving}
          checked={Boolean(value)}
          onChange={(checked) => void save(checked)}
        />
      </span>,
    );
  }

  if (editing && (kind === 'json' || kind === 'long-text')) {
    return (
      <Popover
        visible
        trigger="custom"
        position="bottom"
        onClickOutSide={() => { if (!saving && !jsonError) void save(); }}
        content={(
          // eslint-disable-next-line sonarjs/no-static-element-interactions, jsx-a11y/no-static-element-interactions
          <div
            style={{ width: 420 }}
            className={jsonError ? 'db-admin-json-invalid' : undefined}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Escape') cancel();
            }}
          >
            <TextArea
              value={String(draft ?? '')}
              onChange={(v: string) => setDraft(v)}
              autosize={{ minRows: 3, maxRows: 10 }}
              placeholder={kind === 'json' ? '{ "key": "value" }' : ''}
            />
            {jsonError && (
              <Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
                JSON 错误：{jsonError}
              </Text>
            )}
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <Space>
                <Button size="small" onClick={cancel}>取消</Button>
                <Button
                  size="small"
                  type="primary"
                  loading={saving}
                  disabled={!!jsonError}
                  onClick={() => void save()}
                >
                  保存
                </Button>
              </Space>
            </div>
          </div>
        )}
      >
        <span style={{ cursor: 'text' }}>{formatDisplay(value)}</span>
      </Popover>
    );
  }

  if (editing) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') void save();
      else if (e.key === 'Escape') cancel();
    };
    if (kind === 'int' || kind === 'number') {
      return (
        <InputNumber
          size="small"
          autoFocus
          value={draft as number | string}
          onChange={(v) => setDraft(v)}
          onBlur={() => void save()}
          onKeyDown={onKeyDown}
          precision={kind === 'int' ? 0 : undefined}
          style={{ width: '100%' }}
          disabled={saving}
        />
      );
    }
    return (
      <Input
        size="small"
        autoFocus
        value={String(draft ?? '')}
        onChange={(v) => setDraft(v)}
        onBlur={() => void save()}
        onKeyDown={onKeyDown}
        style={{ width: '100%' }}
        suffix={saving ? <Spin size="small" /> : undefined}
      />
    );
  }

  return wrapWithMenu(
    <button
      type="button"
      className="db-admin-editable-cell"
      onDoubleClick={() => setEditing(true)}
      title="双击编辑 · 右键更多"
    >
      {formatDisplay(value)}
    </button>,
  );
}

EditableCell.displayName = 'EditableCell';

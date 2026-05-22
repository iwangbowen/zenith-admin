import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import {
  Input,
  TextArea,
  InputNumber,
  Switch,
  Popover,
  Button,
  Space,
  Spin,
  Tooltip,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';

import { request } from '@/utils/request';

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
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
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

  const buildPk = (): Record<string, unknown> | null => {
    if (primaryKey.length === 0) return null;
    const pk: Record<string, unknown> = {};
    for (const k of primaryKey) pk[k] = record[k];
    return pk;
  };

  const save = async (overrideValue?: unknown) => {
    if (savedRef.current) return;
    const pk = buildPk();
    if (!pk) {
      Toast.warning('无主键，无法保存');
      return;
    }
    const next = overrideValue === undefined ? toApiValue(draft, kind) : overrideValue;
    const prev = toApiValue(toEditValue(value, kind), kind);
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

  // 只读单元格
  if (readOnly) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>{formatDisplay(value)}</span>;
  }

  // boolean: 直接渲染 Switch，点击即保存
  if (kind === 'bool') {
    return (
      <Switch
        size="small"
        loading={saving}
        checked={Boolean(value)}
        onChange={(checked) => void save(checked)}
      />
    );
  }

  // long-text / json: 使用 Popover + TextArea
  if (editing && (kind === 'json' || kind === 'long-text')) {
    return (
      <Popover
        visible
        trigger="custom"
        position="bottom"
        onClickOutSide={() => { if (!saving) void save(); }}
        content={(
          // eslint-disable-next-line sonarjs/no-static-element-interactions, jsx-a11y/no-static-element-interactions
          <div
            style={{ width: 420 }}
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
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <Space>
                <Button size="small" onClick={cancel}>取消</Button>
                <Button size="small" type="primary" loading={saving} onClick={() => void save()}>
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

  // 内联编辑：int / number / text
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

  return (
    <button
      type="button"
      onDoubleClick={() => setEditing(true)}
      style={{
        cursor: 'cell',
        display: 'inline-block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        padding: 0,
        font: 'inherit',
        color: 'inherit',
      }}
      title="双击编辑"
    >
      {formatDisplay(value)}
    </button>
  );
}

// Re-export for parent usage
EditableCell.displayName = 'EditableCell';

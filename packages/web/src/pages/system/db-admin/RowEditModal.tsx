import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Form, Tag, Banner, Tooltip } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Info } from 'lucide-react';

import { request } from '@/utils/request';

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
  maxLength: number | null;
}

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  schema: string;
  table: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  initial?: Record<string, unknown>;
  focusField?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type FieldKind = 'bool' | 'int' | 'number' | 'json' | 'text' | 'long-text';

function fieldKind(dataType: string): FieldKind {
  const t = dataType.toLowerCase();
  if (t === 'boolean') return 'bool';
  if (/^(small|big)?int|^integer$/.test(t)) return 'int';
  if (/numeric|decimal|real|double/.test(t)) return 'number';
  if (/jsonb?$/.test(t)) return 'json';
  if (/text$|character varying|array|\[\]/.test(t)) return 'long-text';
  return 'text';
}

function toFormValue(raw: unknown, kind: FieldKind): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (kind === 'json' && typeof raw === 'object') return JSON.stringify(raw, null, 2);
  if (kind === 'bool') return Boolean(raw);
  if (kind === 'int' || kind === 'number') return typeof raw === 'string' ? Number(raw) : raw;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') return JSON.stringify(raw);
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') return String(raw);
  return '';
}

function toApiValue(v: unknown, col: ColumnInfo, kind: FieldKind): unknown {
  if (v === undefined || v === null || v === '') {
    return col.isNullable ? null : '';
  }
  if (kind === 'json' && typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

export function RowEditModal(props: Readonly<Props>): JSX.Element {
  const { open, mode, schema, table, columns, primaryKey, initial, focusField, onClose, onSuccess } = props;
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi | null>(null);

  const kinds = useMemo(() => {
    const m = new Map<string, FieldKind>();
    for (const c of columns) m.set(c.name, fieldKind(c.dataType));
    return m;
  }, [columns]);

  const getKind = (name: string): FieldKind => kinds.get(name) ?? 'text';

  const initialValues = useMemo(() => {
    const v: Record<string, unknown> = {};
    for (const c of columns) {
      v[c.name] = toFormValue(initial?.[c.name], fieldKind(c.dataType));
    }
    return v;
  }, [columns, initial]);

  useEffect(() => {
    if (open && focusField) {
      setTimeout(() => {
        const el = document.querySelector(
          `[data-row-field="${focusField}"] input, [data-row-field="${focusField}"] textarea`,
        );
        if (el instanceof HTMLElement) el.focus();
      }, 80);
    }
  }, [open, focusField]);

  const handleSubmit = async () => {
    const values = await formRef.current?.validate();
    if (!values) return;

    setSubmitting(true);
    try {
      if (mode === 'create') {
        const payload: Record<string, unknown> = {};
        for (const c of columns) {
          const raw = (values as Record<string, unknown>)[c.name];
          if (raw === undefined && c.defaultValue) continue;
          payload[c.name] = toApiValue(raw, c, getKind(c.name));
        }
        await request.post(
          `/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows`,
          { values: payload },
        );
      } else {
        const changes: Record<string, unknown> = {};
        const pk: Record<string, unknown> = {};
        for (const c of columns) {
          if (primaryKey.includes(c.name)) {
            pk[c.name] = initial?.[c.name];
            continue;
          }
          const kind = getKind(c.name);
          const formVal = toApiValue((values as Record<string, unknown>)[c.name], c, kind);
          const initVal = toApiValue(toFormValue(initial?.[c.name], kind), c, kind);
          if (JSON.stringify(formVal) !== JSON.stringify(initVal)) {
            changes[c.name] = formVal;
          }
        }
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        await request.patch(
          `/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows`,
          { pk, changes },
        );
      }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (c: ColumnInfo): JSX.Element => {
    const kind = getKind(c.name);
    const fullRow = kind === 'json' || kind === 'long-text';
    const label = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {c.name}
        {c.isPrimaryKey && <Tag size="small" color="orange">PK</Tag>}
        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>{c.dataType}</span>
        {c.comment && (
          <Tooltip content={c.comment}>
            <Info size={12} style={{ color: 'var(--semi-color-text-2)' }} />
          </Tooltip>
        )}
      </span>
    );
    const common = {
      field: c.name,
      label,
      style: { width: '100%' },
      rules: c.isNullable ? undefined : [{ required: true, message: '不能为空' }],
      disabled: mode === 'edit' && c.isPrimaryKey,
    };

    const inner = ((): JSX.Element => {
      if (kind === 'bool') return <Form.Switch {...common} style={undefined} />;
      if (kind === 'int') return <Form.InputNumber {...common} precision={0} />;
      if (kind === 'number') return <Form.InputNumber {...common} />;
      if (fullRow) {
        return (
          <Form.TextArea
            {...common}
            autosize={{ minRows: 2, maxRows: 6 }}
            placeholder={kind === 'json' ? '{ "key": "value" }' : ''}
          />
        );
      }
      return <Form.Input {...common} maxLength={c.maxLength ?? undefined} />;
    })();

    return (
      <div
        key={c.name}
        data-row-field={c.name}
        style={{ gridColumn: fullRow ? '1 / -1' : 'auto', minWidth: 0 }}
      >
        {inner}
      </div>
    );
  };

  const pkCols = columns.filter((c) => c.isPrimaryKey);
  const restCols = columns.filter((c) => !c.isPrimaryKey);

  return (
    <AppModal
      visible={open}
      title={mode === 'create' ? `新增行 · ${schema}.${table}` : `编辑行 · ${schema}.${table}`}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={mode === 'create' ? '插入' : '保存'}
      cancelText="取消"
      width={880}
      confirmLoading={submitting}
      maskClosable={false}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
    >
      {mode === 'edit' && primaryKey.length === 0 && (
        <Banner
          type="warning"
          description="该表无主键，无法保存修改"
          closeIcon={null}
          style={{ marginBottom: 12 }}
        />
      )}
      <Form
        labelPosition="top"
        allowEmpty
        initValues={initialValues}
        getFormApi={(api) => { formRef.current = api; }}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}
      >
        {pkCols.map(renderField)}
        {restCols.map(renderField)}
      </Form>
    </AppModal>
  );
}

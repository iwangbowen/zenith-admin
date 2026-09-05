import { Fragment, type ReactNode } from 'react';
import { Button, Input, InputNumber, Select, Switch, TagInput } from '@douyinfe/semi-ui';
import * as z from 'zod';
import { SettingDivider, SettingRow, SettingSection } from './SettingRow';

/**
 * 由 Zod 读取 schema 驱动的设置表单：布尔 → Switch、数值 → InputNumber（min / max 取自 schema 约束）、
 * 枚举 → Select、字符串 → Input、字符串数组 → TagInput、嵌套对象 → 分组。
 * 标签 / 说明取字段 `.meta({ title, description })`，新增设置项只改 shared schema，页面零改动。
 *
 * 受控组件：`value` 为完整生效文档，`onChange` 回传替换后的完整文档；`inheritedValue` 用于「已覆盖」标记与「恢复继承」。
 */
export interface SchemaFormProps {
  readonly schema: z.ZodObject;
  readonly value: Record<string, unknown>;
  readonly inheritedValue?: Record<string, unknown>;
  readonly onChange: (next: Record<string, unknown>) => void;
  readonly disabled?: boolean;
  /** 是否显示「恢复继承」操作（租户作用域 / 平台作用域相对默认值均适用） */
  readonly allowRevert?: boolean;
  /** 枚举字段的展示文案：键为字段路径（a.b），值为 value → label；缺省显示原始值 */
  readonly enumLabels?: Record<string, Record<string, string>>;
}

interface FieldMeta {
  title?: string;
  description?: string;
}

type LeafKind =
  | { kind: 'boolean' }
  | { kind: 'number'; int: boolean; min?: number; max?: number; nullable: boolean }
  | { kind: 'enum'; options: string[] }
  | { kind: 'string'; maxLength?: number }
  | { kind: 'string-array'; maxItems?: number }
  | { kind: 'object'; shape: Record<string, z.ZodType> }
  | { kind: 'unknown' };

interface FieldInfo {
  meta: FieldMeta;
  leaf: LeafKind;
}

type Check = { check: string; value?: number; inclusive?: boolean; maximum?: number; minimum?: number };

function checksOf(schema: z.ZodType): Check[] {
  const checks = (schema.def as { checks?: Array<{ _zod: { def: Check } }> }).checks ?? [];
  return checks.map((c) => c._zod.def);
}

/** 剥掉 default / prefault / optional / nullable 包装；沿途收集第一份 meta 与 nullable 标记 */
function describe(field: z.ZodType): FieldInfo {
  let current = field;
  let meta: FieldMeta = {};
  let nullable = false;
  for (;;) {
    const m = current.meta() as FieldMeta | undefined;
    if (m && (m.title || m.description) && !meta.title) meta = { title: m.title, description: m.description };
    const def = current.def as { type: string; innerType?: z.ZodType };
    if (def.type === 'nullable') nullable = true;
    if ((def.type === 'default' || def.type === 'prefault' || def.type === 'optional' || def.type === 'nullable') && def.innerType) {
      current = def.innerType;
      continue;
    }
    break;
  }
  const def = current.def as { type: string; entries?: Record<string, string>; element?: z.ZodType };
  switch (def.type) {
    case 'boolean':
      return { meta, leaf: { kind: 'boolean' } };
    case 'number': {
      const checks = checksOf(current);
      const gt = checks.find((c) => c.check === 'greater_than');
      const lt = checks.find((c) => c.check === 'less_than');
      const int = checks.some((c) => c.check === 'number_format') || (current.def as { format?: string }).format === 'safeint';
      // 开区间约束（positive() / negative()）只能在整数上精确折算成闭区间
      const bound = (c: Check | undefined, step: number) =>
        c?.value === undefined ? undefined : c.inclusive === false && int ? c.value + step : c.value;
      return { meta, leaf: { kind: 'number', int, min: bound(gt, 1), max: bound(lt, -1), nullable } };
    }
    case 'enum':
      return { meta, leaf: { kind: 'enum', options: Object.values(def.entries ?? {}) } };
    case 'string':
      return { meta, leaf: { kind: 'string', maxLength: checksOf(current).find((c) => c.check === 'max_length')?.maximum } };
    case 'array': {
      const element = def.element ? describe(def.element) : null;
      if (element?.leaf.kind === 'string' || element?.leaf.kind === 'enum') {
        return { meta, leaf: { kind: 'string-array', maxItems: checksOf(current).find((c) => c.check === 'max_length')?.maximum } };
      }
      return { meta, leaf: { kind: 'unknown' } };
    }
    case 'object':
      return { meta, leaf: { kind: 'object', shape: (current as z.ZodObject).shape as Record<string, z.ZodType> } };
    default:
      return { meta, leaf: { kind: 'unknown' } };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setPath(doc: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 1) return { ...doc, [path[0]]: value };
  const [head, ...rest] = path;
  const child = (doc[head] ?? {}) as Record<string, unknown>;
  return { ...doc, [head]: setPath(child, rest, value) };
}

function getPath(doc: Record<string, unknown> | undefined, path: string[]): unknown {
  return path.reduce<unknown>((acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined), doc);
}

export function SchemaForm({ schema, value, inheritedValue, onChange, disabled, allowRevert = true, enumLabels }: SchemaFormProps) {
  const update = (path: string[], next: unknown) => onChange(setPath(value, path, next));

  const renderLeaf = (path: string[], info: FieldInfo): ReactNode => {
    const key = path.join('.');
    const current = getPath(value, path);
    const inherited = inheritedValue ? getPath(inheritedValue, path) : undefined;
    const overridden = inheritedValue !== undefined && !sameValue(current, inherited);
    const revert = allowRevert && overridden && !disabled
      ? <Button size="small" theme="borderless" onClick={() => update(path, inherited)}>恢复继承</Button>
      : null;
    const title = info.meta.title ?? path[path.length - 1];
    let control: ReactNode;
    switch (info.leaf.kind) {
      case 'boolean':
        control = <Switch checked={Boolean(current)} disabled={disabled} onChange={(v) => update(path, v)} />;
        break;
      case 'number': {
        const { min, max, int, nullable } = info.leaf;
        control = (
          <InputNumber
            style={{ width: 160 }}
            min={min}
            max={max}
            precision={int ? 0 : undefined}
            disabled={disabled}
            value={typeof current === 'number' ? current : undefined}
            placeholder={nullable ? '留空 = 未设置' : undefined}
            onChange={(v) => {
              if (typeof v === 'number' && Number.isFinite(v)) update(path, int ? Math.trunc(v) : v);
              else if (nullable) update(path, null);
            }}
          />
        );
        break;
      }
      case 'enum':
        control = (
          <Select
            style={{ width: 200 }}
            disabled={disabled}
            value={typeof current === 'string' ? current : undefined}
            optionList={info.leaf.options.map((option) => ({ value: option, label: enumLabels?.[key]?.[option] ?? option }))}
            onChange={(v) => update(path, v)}
          />
        );
        break;
      case 'string':
        control = (
          <Input
            style={{ width: 280 }}
            disabled={disabled}
            maxLength={info.leaf.maxLength}
            value={typeof current === 'string' ? current : ''}
            onChange={(v) => update(path, v)}
          />
        );
        break;
      case 'string-array':
        control = (
          <TagInput
            style={{ width: 360, maxWidth: '100%' }}
            disabled={disabled}
            max={info.leaf.maxItems}
            value={Array.isArray(current) ? (current as string[]) : []}
            allowDuplicates={false}
            separator={[',', ' ', '\n']}
            addOnBlur
            placeholder="输入后按回车添加"
            onChange={(v) => update(path, v)}
          />
        );
        break;
      default:
        control = <span style={{ color: 'var(--semi-color-text-2)' }}>该字段类型暂不支持在通用设置页编辑</span>;
    }
    return <SettingRow key={key} title={title} description={info.meta.description} control={control} overridden={overridden} extra={revert} />;
  };

  const renderShape = (shape: Record<string, z.ZodType>, path: string[]): ReactNode => {
    const entries = Object.entries(shape);
    const leaves = entries.filter(([, field]) => describe(field).leaf.kind !== 'object');
    const groups = entries.filter(([, field]) => describe(field).leaf.kind === 'object');
    return (
      <>
        {leaves.map(([name, field], index) => (
          <Fragment key={name}>
            {index > 0 ? <SettingDivider /> : null}
            {renderLeaf([...path, name], describe(field))}
          </Fragment>
        ))}
        {groups.map(([name, field]) => {
          const info = describe(field);
          if (info.leaf.kind !== 'object') return null;
          return (
            <SettingSection key={name} title={info.meta.title ?? name} description={info.meta.description}>
              {renderShape(info.leaf.shape, [...path, name])}
            </SettingSection>
          );
        })}
      </>
    );
  };

  return <div>{renderShape(schema.shape as Record<string, z.ZodType>, [])}</div>;
}

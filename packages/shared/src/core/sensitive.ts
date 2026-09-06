import * as z from 'zod';
import { createLabelOptionsFromMap } from './enum-options';

/**
 * 敏感字段契约：声明、发现与脱敏原语（纯函数，前后端与 Mock 共用）。
 *
 * - 契约实体里用 `sensitive(z.string(), 'phone')` 声明字段的敏感类别；这是「哪些字段是 PII」的唯一真相
 * - `collectSensitiveFields(responseSchema)` 静态遍历响应 schema，得到每个敏感字段在载荷中的路径、
 *   所属实体（最近一层带 `meta.id` 的对象）与默认脱敏类型；服务端在契约路由出口按它打码，
 *   前端表单据此锁定字段，导出中心据此打码列
 * - 脱敏原语一律 **fail-closed**：格式不符合预期的值不会原样放行，而是退回通用尾部保留策略
 */

// ─── 脱敏类型 ─────────────────────────────────────────────────────────────────

export const MASK_TYPES = ['phone', 'email', 'id_card', 'name', 'bank_card', 'address', 'redact', 'custom'] as const;

export type MaskType = (typeof MASK_TYPES)[number];

export const MASK_TYPE_LABELS: Record<MaskType, string> = {
  phone: '手机号',
  email: '邮箱',
  id_card: '身份证号',
  name: '姓名',
  bank_card: '银行卡号',
  address: '地址',
  redact: '全部遮蔽',
  custom: '自定义',
};

export const MASK_TYPE_OPTIONS = createLabelOptionsFromMap(MASK_TYPE_LABELS);

/** 自定义规则：保留前 N + 后 M 位，其余以 maskChar 填充 */
export interface CustomMaskRule {
  prefixKeep: number;
  suffixKeep: number;
  maskChar?: string;
}

export const DEFAULT_MASK_CHAR = '*';

/** `redact` 类型的固定输出：不泄露长度 */
export const REDACTED_TEXT = '******';

/** `custom` 类型缺少规则时的兜底（fail-closed：仍然打码，而不是放行明文） */
export const DEFAULT_CUSTOM_MASK_RULE: CustomMaskRule = { prefixKeep: 1, suffixKeep: 1 };

// ─── 原语 ─────────────────────────────────────────────────────────────────────

/** 按 Unicode 码点切分，避免代理对（emoji / 生僻字）被切成半个字符 */
const graphemes = (value: string): string[] => Array.from(value);

/**
 * 通用尾部保留：保留末尾至多 `keep` 位（且不超过总长一半），其余打码。
 * 格式不符合预期的值统一走这里，保证任何非空输入都会被打码。
 */
function maskTail(value: string, keep: number, maskChar = DEFAULT_MASK_CHAR): string {
  const parts = graphemes(value);
  const kept = Math.min(keep, Math.floor(parts.length / 2));
  return maskChar.repeat(parts.length - kept) + parts.slice(parts.length - kept).join('');
}

/** 手机号：13812341234 → 138****1234；可带 +86 / 86 前缀；其他格式退回尾部保留 4 位 */
export function maskPhone(value: string): string {
  const match = /^(\+?\d{1,3}[- ]?)?(1[3-9]\d)(\d{4})(\d{4})$/.exec(value);
  if (match) return `${match[1] ?? ''}${match[2]}****${match[4]}`;
  return maskTail(value, 4);
}

/** 邮箱：保留本地名前 1/3（至少 1 位、至多 3 位）+ 完整域名；无 @ 退回尾部保留 2 位 */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskTail(value, 2);
  const local = graphemes(value.slice(0, at));
  const keep = Math.min(3, Math.max(1, Math.ceil(local.length / 3)));
  return local.slice(0, keep).join('') + DEFAULT_MASK_CHAR.repeat(Math.max(local.length - keep, 3)) + value.slice(at);
}

/** 身份证：保留前 6 + 后 4（15 / 18 位）；其他长度退回尾部保留 4 位 */
export function maskIdCard(value: string): string {
  if (/^\d{15}$|^\d{17}[\dXx]$/.test(value)) {
    return value.slice(0, 6) + DEFAULT_MASK_CHAR.repeat(value.length - 10) + value.slice(-4);
  }
  return maskTail(value, 4);
}

/** 姓名：单字全遮蔽，双字保留首字，三字及以上保留首尾 */
export function maskName(value: string): string {
  const parts = graphemes(value);
  if (parts.length <= 1) return DEFAULT_MASK_CHAR;
  if (parts.length === 2) return parts[0] + DEFAULT_MASK_CHAR;
  return parts[0] + DEFAULT_MASK_CHAR.repeat(parts.length - 2) + parts[parts.length - 1];
}

/** 银行卡：仅保留后 4 位 */
export function maskBankCard(value: string): string {
  return maskTail(value, 4);
}

/** 地址：保留前 6 位（省市级），其余固定 4 位遮蔽以隐藏长度；过短退回尾部保留 */
export function maskAddress(value: string): string {
  const parts = graphemes(value);
  if (parts.length <= 6) return maskTail(value, 2);
  return parts.slice(0, 6).join('') + DEFAULT_MASK_CHAR.repeat(4);
}

/** 自定义：保留前 N + 后 M；总长不足以保留时全部遮蔽（不放行明文） */
export function maskCustom(value: string, rule: CustomMaskRule): string {
  const maskChar = rule.maskChar || DEFAULT_MASK_CHAR;
  const prefixKeep = Math.max(0, Math.floor(rule.prefixKeep));
  const suffixKeep = Math.max(0, Math.floor(rule.suffixKeep));
  const parts = graphemes(value);
  if (parts.length <= prefixKeep + suffixKeep) return maskChar.repeat(parts.length);
  return (
    parts.slice(0, prefixKeep).join('') +
    maskChar.repeat(parts.length - prefixKeep - suffixKeep) +
    (suffixKeep > 0 ? parts.slice(parts.length - suffixKeep).join('') : '')
  );
}

/**
 * 统一脱敏入口。非字符串 / 空串原样返回（由调用方决定是否需要处理）；
 * `custom` 缺少规则时使用 `DEFAULT_CUSTOM_MASK_RULE`。
 */
export function applyMask<T>(value: T, type: MaskType, customRule?: CustomMaskRule | null): T | string {
  if (typeof value !== 'string' || value === '') return value;
  switch (type) {
    case 'phone': return maskPhone(value);
    case 'email': return maskEmail(value);
    case 'id_card': return maskIdCard(value);
    case 'name': return maskName(value);
    case 'bank_card': return maskBankCard(value);
    case 'address': return maskAddress(value);
    case 'redact': return REDACTED_TEXT;
    case 'custom': return maskCustom(value, customRule ?? DEFAULT_CUSTOM_MASK_RULE);
  }
}

/** 规则生效时使用的掩码字符（`custom` 可配置，其余类型固定 `*`） */
export function maskCharOf(type: MaskType, customRule?: CustomMaskRule | null): string {
  return type === 'custom' ? (customRule?.maskChar || DEFAULT_MASK_CHAR) : DEFAULT_MASK_CHAR;
}

/**
 * 判断一个值是否「像」脱敏后的输出：手机号 / 邮箱 / 证件号 / 姓名等真实值不会含 `*`，
 * 自定义掩码字符则要求连续出现 2 次以上。用于拒绝把脱敏值回写进数据库。
 */
export function looksMasked(value: unknown, type: MaskType, customRule?: CustomMaskRule | null): boolean {
  if (typeof value !== 'string' || value === '') return false;
  if (type === 'redact') return value === REDACTED_TEXT;
  const maskChar = maskCharOf(type, customRule);
  if (maskChar === DEFAULT_MASK_CHAR) return value.includes(DEFAULT_MASK_CHAR);
  return value.includes(maskChar.repeat(2));
}

/** 各类型的效果示例（由真实实现计算，前端预览与服务端行为不会漂移） */
export const MASK_TYPE_SAMPLES: Record<MaskType, string> = {
  phone: '13812341234',
  email: 'admin@example.com',
  id_card: '110101199001011234',
  name: '张三丰',
  bank_card: '6222021234567890',
  address: '北京市朝阳区建国路 88 号',
  redact: '任意内容',
  custom: 'ABCDEFGH',
};

export function previewMask(type: MaskType, customRule?: CustomMaskRule | null, sample?: string): string {
  return String(applyMask(sample ?? MASK_TYPE_SAMPLES[type], type, customRule));
}

// ─── 契约声明 ─────────────────────────────────────────────────────────────────

/** 敏感类别写入 schema 元数据的键；`x-` 前缀使其可作为 OpenAPI 扩展字段原样输出 */
export const SENSITIVE_META_KEY = 'x-sensitive';

/**
 * 标记契约实体字段为敏感字段：`phone: sensitive(z.string().nullable(), 'phone')`。
 * `label` 进入 `title`（脱敏策略页展示），缺省取类型标签。
 */
export function sensitive<S extends z.ZodType>(schema: S, kind: MaskType, label?: string): S {
  return schema.meta({ [SENSITIVE_META_KEY]: kind, title: label ?? MASK_TYPE_LABELS[kind] }) as S;
}

/** 读取字段上声明的敏感类别；未声明返回 undefined */
export function sensitiveKindOf(schema: z.ZodType): MaskType | undefined {
  const kind = schema.meta()?.[SENSITIVE_META_KEY];
  return typeof kind === 'string' && (MASK_TYPES as readonly string[]).includes(kind) ? (kind as MaskType) : undefined;
}

/** 载荷路径段：对象键，或 `[]` 表示数组的每个元素 */
export const ARRAY_SEGMENT = '[]';

export interface SensitiveFieldRef {
  /** 从载荷根到该字段的路径（`list`, `[]`, `phone`） */
  readonly path: readonly string[];
  /** 所属实体：最近一层带 `meta.id` 的对象 schema */
  readonly entity: string;
  /** 相对实体的字段路径，嵌套时以 `.` 连接（`initialAdmin.email`） */
  readonly field: string;
  /** 契约声明的默认脱敏类型 */
  readonly kind: MaskType;
  readonly label: string;
}

/** `entity.field`，策略表与前端锁定字段使用的键 */
export function sensitiveKeyOf(ref: Pick<SensitiveFieldRef, 'entity' | 'field'>): string {
  return `${ref.entity}.${ref.field}`;
}

interface WalkFrame {
  schema: z.ZodType;
  path: string[];
  entity: string | null;
  fieldPath: string[];
}

const MAX_DEPTH = 12;

type AnyDef = { type: string } & Record<string, unknown>;

function defOf(schema: z.ZodType): AnyDef {
  return (schema as unknown as { _zod: { def: AnyDef } })._zod.def;
}

function childrenOf(schema: z.ZodType): z.ZodType[] {
  const def = defOf(schema);
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
    case 'success':
      return [def.innerType as z.ZodType];
    case 'pipe':
      return [def.out as z.ZodType];
    case 'lazy':
      return [(def.getter as () => z.ZodType)()];
    case 'union':
      return [...(def.options as z.ZodType[])];
    case 'intersection':
      return [def.left as z.ZodType, def.right as z.ZodType];
    default:
      return [];
  }
}

/**
 * 静态遍历响应 schema，收集全部敏感字段。
 *
 * - 对象按 `shape` 下钻、数组下钻元素（路径段 `[]`）、可选 / 可空 / 默认值 / 管道 / 联合等包装透传
 * - 敏感字段所在的对象（或其祖先）必须声明 `meta.id`，否则抛错：策略键需要稳定的实体名
 * - `lazy` 递归结构以深度上限截断
 */
export function collectSensitiveFields(schema: z.ZodType): SensitiveFieldRef[] {
  const refs: SensitiveFieldRef[] = [];
  const visit = (frame: WalkFrame, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const { schema: node } = frame;
    const kind = sensitiveKindOf(node);
    if (kind) {
      if (!frame.entity) {
        throw new Error(`敏感字段「${frame.path.join('.') || '<root>'}」所在对象必须声明 meta.id，策略键需要稳定的实体名`);
      }
      refs.push({
        path: [...frame.path],
        entity: frame.entity,
        field: frame.fieldPath.join('.'),
        kind,
        label: (node.meta()?.title as string | undefined) ?? MASK_TYPE_LABELS[kind],
      });
      return;
    }
    const def = defOf(node);
    if (def.type === 'object') {
      const id = node.meta()?.id;
      const entity = typeof id === 'string' && id ? id : frame.entity;
      const fieldBase = entity === frame.entity ? frame.fieldPath : [];
      const shape = (node as z.ZodObject).shape as Record<string, z.ZodType>;
      for (const [key, child] of Object.entries(shape)) {
        visit({ schema: child, path: [...frame.path, key], entity, fieldPath: [...fieldBase, key] }, depth + 1);
      }
      return;
    }
    if (def.type === 'array') {
      visit({ ...frame, schema: def.element as z.ZodType, path: [...frame.path, ARRAY_SEGMENT], fieldPath: [...frame.fieldPath, ARRAY_SEGMENT] }, depth + 1);
      return;
    }
    for (const child of childrenOf(node)) visit({ ...frame, schema: child }, depth + 1);
  };
  visit({ schema, path: [], entity: null, fieldPath: [] }, 0);
  return refs;
}

// ─── 载荷打码 ─────────────────────────────────────────────────────────────────

export interface MaskDecision {
  readonly maskType: MaskType;
  readonly customRule?: CustomMaskRule | null;
}

/**
 * 沿 `path` 打码载荷，返回打码后的根节点。写时复制：只克隆路径经过的容器（对象 / 数组），
 * 其余引用原样保留——handler 返回的可能是缓存或共享对象，不能就地修改。
 */
export function maskAtPath<T>(data: T, path: readonly string[], decision: MaskDecision): T {
  if (data === null || data === undefined || path.length === 0) return data;
  const [head, ...rest] = path;
  if (head === ARRAY_SEGMENT) {
    if (!Array.isArray(data)) return data;
    let changed = false;
    const next = data.map((item) => {
      const value = rest.length === 0 ? applyMask(item, decision.maskType, decision.customRule) : maskAtPath(item, rest, decision);
      if (value !== item) changed = true;
      return value;
    });
    return (changed ? next : data) as T;
  }
  if (typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!(head in record)) return data;
  const next = rest.length === 0
    ? applyMask(record[head], decision.maskType, decision.customRule)
    : maskAtPath(record[head], rest, decision);
  return next === record[head] ? data : ({ ...record, [head]: next } as T);
}

/** 沿 `ref.path` 读取载荷中的全部值（数组段展开），供回写校验等场景检查 */
export function valuesAtPath(data: unknown, path: readonly string[]): unknown[] {
  if (data === null || data === undefined) return [];
  if (path.length === 0) return [data];
  const [head, ...rest] = path;
  if (head === ARRAY_SEGMENT) {
    return Array.isArray(data) ? data.flatMap((item) => valuesAtPath(item, rest)) : [];
  }
  if (typeof data !== 'object' || Array.isArray(data)) return [];
  return valuesAtPath((data as Record<string, unknown>)[head], rest);
}

import { collectSensitiveFields, sensitiveKeyOf, type AnyOperation, type SensitiveFieldRef } from '@zenith/shared/core';

/**
 * 敏感字段注册表：每条契约路由在定义时把响应 schema 里 `sensitive()` 声明的字段登记进来，
 * 因此注册表就是「本进程实际对外暴露的敏感字段全集」——脱敏策略页据此列出可配置项，
 * 不再依赖扫描数据库列名猜测。
 */

export interface SensitiveFieldEntry {
  readonly key: string;
  readonly entity: string;
  readonly field: string;
  readonly kind: SensitiveFieldRef['kind'];
  readonly label: string;
  /** 暴露该字段的操作（`METHOD /path`），策略页展示影响面 */
  readonly operations: readonly string[];
}

const byOperation = new Map<string, readonly SensitiveFieldRef[]>();

function operationId(op: AnyOperation): string {
  return `${op.method.toUpperCase()} ${op.fullPath}`;
}

/** 契约路由定义时调用：计算并登记响应中的敏感字段；`unmasked` / 非 JSON 操作不登记 */
export function registerOperationSensitivity(op: AnyOperation): readonly SensitiveFieldRef[] {
  if (op.kind !== 'json' || op.unmasked) return [];
  const id = operationId(op);
  const cached = byOperation.get(id);
  if (cached) return cached;
  const refs = collectSensitiveFields(op.response);
  byOperation.set(id, refs);
  return refs;
}

/**
 * 非契约出口（PDF 打印 / 文件导出等二进制通道）登记其打码的敏感字段：策略页据此列出可配置项，
 * 出口自身在生成内容前调用 `resolveMaskDecisions(refs)` 应用同一套策略与豁免。
 * `source` 用 `KIND target` 形式（如 `PRINT workflow_instance`）与 `METHOD /path` 区分。
 */
export function registerSensitiveSource(source: string, refs: readonly SensitiveFieldRef[]): readonly SensitiveFieldRef[] {
  byOperation.set(source, refs);
  return refs;
}

/** 全部已登记的敏感字段，按 `entity.field` 去重并按实体 / 字段排序 */
export function listSensitiveFieldEntries(): SensitiveFieldEntry[] {
  const merged = new Map<string, { ref: SensitiveFieldRef; operations: Set<string> }>();
  for (const [id, refs] of byOperation) {
    for (const ref of refs) {
      const key = sensitiveKeyOf(ref);
      const entry = merged.get(key) ?? { ref, operations: new Set<string>() };
      entry.operations.add(id);
      merged.set(key, entry);
    }
  }
  return [...merged.entries()]
    .map(([key, { ref, operations }]) => ({
      key,
      entity: ref.entity,
      field: ref.field,
      kind: ref.kind,
      label: ref.label,
      operations: [...operations].sort(),
    }))
    .sort((a, b) => a.entity.localeCompare(b.entity) || a.field.localeCompare(b.field));
}

export function findSensitiveFieldEntry(entity: string, field: string): SensitiveFieldEntry | undefined {
  return listSensitiveFieldEntries().find((entry) => entry.entity === entity && entry.field === field);
}

/** 仅供测试重置 */
export function resetSensitiveFieldRegistryForTest(): void {
  byOperation.clear();
}

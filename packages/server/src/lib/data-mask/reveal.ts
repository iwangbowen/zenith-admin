import { HTTPException } from 'hono/http-exception';
import { valuesAtPath } from '@zenith/shared/core';

/**
 * 按需查看明文的数据源注册表。
 *
 * 各业务 service 在模块加载时登记「实体名 → 按 id 读取一条记录」的加载器；加载器必须复用
 * 该实体自己的读取函数（携带租户 / 数据范围校验，不可见即 404），reveal 才不会成为越权读取通道。
 */

export type RevealLoader = (id: number) => Promise<Record<string, unknown> | null | undefined>;

const sources = new Map<string, RevealLoader>();

export function registerRevealSource(entity: string, loader: RevealLoader): void {
  sources.set(entity, loader);
}

export function hasRevealSource(entity: string): boolean {
  return sources.has(entity);
}

/** 读取指定记录上某个敏感字段的明文；实体未登记加载器 → 400，记录不可见 → 404 */
export async function loadRevealValue(entity: string, id: number, field: string): Promise<string | null> {
  const loader = sources.get(entity);
  if (!loader) throw new HTTPException(400, { message: `实体 ${entity} 不支持按需查看明文` });
  const record = await loader(id);
  if (!record) throw new HTTPException(404, { message: '记录不存在或无权查看' });
  const [value] = valuesAtPath(record, field.split('.'));
  return typeof value === 'string' ? value : null;
}

/** 仅供测试重置 */
export function resetRevealSourcesForTest(): void {
  sources.clear();
}

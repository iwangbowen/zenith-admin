import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { looksMasked, maskAtPath, sensitiveKeyOf, type AnyOperation, type SensitiveFieldRef } from '@zenith/shared/core';
import { getPolicyMap, resolveEffectivePolicy, resolveMaskDecisions, type FieldMaskDecision } from './policies';
import { registerOperationSensitivity } from './registry';

/**
 * 契约路由的脱敏边界。
 *
 * 响应侧：handler 通过 `c.json(okBody(data))` 出口时，按契约声明的敏感字段路径与当前查看者的
 * 策略决策打码——脱敏因此对所有契约路由默认生效，service 不再逐处手工调用。
 *
 * 请求侧：写操作的请求体若在敏感字段上携带「像脱敏输出」的值（`138****1234`），
 * 一律 400 拒绝——这是非豁免用户把详情回填进表单再原样保存时会发生的事，放行等于把掩码写进数据库。
 */

type Handler = (c: Context) => Response | Promise<Response>;

interface BoundaryPlan {
  readonly responseRefs: readonly SensitiveFieldRef[];
  /** 请求体顶层键 → 对应的响应实体字段（同名即视为同一字段） */
  readonly bodyRefs: readonly SensitiveFieldRef[];
}

function bodyShapeKeys(op: AnyOperation): Set<string> {
  const body = op.body as { _zod?: { def?: { type?: string; shape?: Record<string, unknown> } } } | undefined;
  let def = body?._zod?.def;
  // 请求体常经 superRefine / transform 包装为 pipe，取输入侧对象
  while (def && def.type === 'pipe') {
    def = (def as { in?: { _zod?: { def?: typeof def } } }).in?._zod?.def;
  }
  return new Set(def?.type === 'object' && def.shape ? Object.keys(def.shape) : []);
}

export function planBoundary(op: AnyOperation): BoundaryPlan | null {
  const responseRefs = registerOperationSensitivity(op);
  if (responseRefs.length === 0) return null;
  const writable = op.method !== 'get' && op.method !== 'delete' && op.body !== undefined;
  const keys = writable ? bodyShapeKeys(op) : new Set<string>();
  // 只有「响应即实体」（字段位于载荷顶层）的写操作，请求体字段才与响应字段同名对应
  const bodyRefs = responseRefs.filter((ref) => ref.path.length === 1 && keys.has(ref.path[0]));
  return { responseRefs, bodyRefs };
}

async function rejectMaskedEchoes(c: Context, refs: readonly SensitiveFieldRef[]): Promise<void> {
  const validated = (c.req as unknown as { valid: (target: 'json') => unknown }).valid('json');
  if (!validated || typeof validated !== 'object') return;
  const body = validated as Record<string, unknown>;
  const map = await getPolicyMap();
  for (const ref of refs) {
    const value = body[ref.path[0]];
    if (typeof value !== 'string') continue;
    const effective = resolveEffectivePolicy(ref, map.get(sensitiveKeyOf(ref)));
    if (looksMasked(value, effective.maskType, effective.customRule)) {
      throw new HTTPException(400, { message: `「${ref.label}」是脱敏后的值，请重新输入完整内容或留空保持不变` });
    }
  }
}

function interceptJson(c: Context, decisions: readonly FieldMaskDecision[]): void {
  const original = c.json.bind(c);
  const masked = (object: unknown, ...rest: unknown[]) => {
    const body = object as { code?: unknown; data?: unknown } | null;
    if (body && typeof body === 'object' && body.code === 0 && body.data !== undefined && body.data !== null) {
      let data = body.data;
      for (const { ref, decision } of decisions) data = maskAtPath(data, ref.path, decision);
      if (data !== body.data) object = { ...body, data };
    }
    return (original as (...args: unknown[]) => Response)(object, ...rest);
  };
  (c as unknown as { json: unknown }).json = masked;
}

/** 为契约路由 handler 施加请求侧回写保护与响应侧脱敏；无敏感字段的操作原样返回 */
export function withDataMasking<H extends Handler>(op: AnyOperation, handler: H): H {
  const plan = planBoundary(op);
  if (!plan) return handler;
  const guarded: Handler = async (c) => {
    if (plan.bodyRefs.length > 0) await rejectMaskedEchoes(c, plan.bodyRefs);
    const decisions = await resolveMaskDecisions(plan.responseRefs);
    if (decisions.length > 0) interceptJson(c, decisions);
    return handler(c);
  };
  return guarded as H;
}

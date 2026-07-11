/**
 * 行为中心阶段 1：Tracking Plan 种子常量一致性校验。
 *
 * 确保 `SEED_ANALYTICS_EVENT_META`（DB seed / MSW mock 共用的事件字典种子）与
 * `ANALYTICS_SEMANTIC_EVENT_NAMES`（服务端订阅桥接 / 会员业务调用点唯一引用的事件名常量）
 * 完全一致（无缺失、无多余、无拼写漂移），避免"代码里改了事件名，种子/字典没同步"的静默漂移。
 */
import { describe, expect, it } from 'vitest';
import {
  SEED_ANALYTICS_EVENT_META,
  ANALYTICS_SEMANTIC_EVENT_NAMES,
  ANALYTICS_SERVER_PAYMENT_EVENT_NAMES,
  ANALYTICS_SERVER_WORKFLOW_EVENT_NAMES,
  ANALYTICS_SERVER_MEMBER_EVENT_NAMES,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE,
  ANALYTICS_SEMANTIC_EVENT_LABELS,
} from '@zenith/shared';

describe('SEED_ANALYTICS_EVENT_META 与 ANALYTICS_SEMANTIC_EVENT_NAMES 一致性', () => {
  it('首批事件总数为 1（系统）+ 5（支付）+ 15（工作流）+ 10（会员）= 31', () => {
    expect(ANALYTICS_SERVER_PAYMENT_EVENT_NAMES.length).toBe(5);
    expect(ANALYTICS_SERVER_WORKFLOW_EVENT_NAMES.length).toBe(15);
    expect(ANALYTICS_SERVER_MEMBER_EVENT_NAMES.length).toBe(10);
    expect(ANALYTICS_SEMANTIC_EVENT_NAMES.length).toBe(31);
  });

  it('SEED_ANALYTICS_EVENT_META 覆盖 ANALYTICS_SEMANTIC_EVENT_NAMES 的每一个事件名，且无多余/重复', () => {
    const seedNames = SEED_ANALYTICS_EVENT_META.map((m) => m.eventName);
    expect(new Set(seedNames).size).toBe(seedNames.length); // 无重复
    expect([...seedNames].sort()).toEqual([...ANALYTICS_SEMANTIC_EVENT_NAMES].sort());
  });

  it('seed id 无重复（DB 主键安全）', () => {
    const ids = SEED_ANALYTICS_EVENT_META.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条种子都有非空 displayName，且与 ANALYTICS_SEMANTIC_EVENT_LABELS 一致', () => {
    for (const meta of SEED_ANALYTICS_EVENT_META) {
      expect(meta.displayName).toBeTruthy();
      expect(meta.displayName).toBe(ANALYTICS_SEMANTIC_EVENT_LABELS[meta.eventName]);
    }
  });

  it('ANALYTICS_EVENT_NAMES 具名常量表的每个值都落在 ANALYTICS_SEMANTIC_EVENT_NAMES 之内（会员/支付调用点引用）', () => {
    const nameSet = new Set(ANALYTICS_SEMANTIC_EVENT_NAMES as readonly string[]);
    for (const name of Object.values(ANALYTICS_EVENT_NAMES)) {
      expect(nameSet.has(name)).toBe(true);
    }
  });

  it('ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE 覆盖全部 5 种积分交易类型，且值均为合法事件名', () => {
    const txTypes = ['earn', 'redeem', 'expire', 'adjust', 'refund'] as const;
    const nameSet = new Set(ANALYTICS_SEMANTIC_EVENT_NAMES as readonly string[]);
    for (const t of txTypes) {
      expect(ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE[t]).toBeDefined();
      expect(nameSet.has(ANALYTICS_MEMBER_POINTS_EVENT_BY_TX_TYPE[t])).toBe(true);
    }
  });

  it('每条种子的 propertySchema（若非 null）不含空 key，且 type 为合法枚举', () => {
    const validTypes = new Set(['string', 'number', 'boolean', 'object', 'array']);
    for (const meta of SEED_ANALYTICS_EVENT_META) {
      if (!meta.propertySchema) continue;
      for (const field of meta.propertySchema) {
        expect(field.key).toBeTruthy();
        expect(validTypes.has(field.type)).toBe(true);
      }
    }
  });
});

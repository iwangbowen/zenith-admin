import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { ANALYTICS_PROPERTIES_MAX_BYTES, createErrorAlertRuleSchema, funnelStepSchema, trackEventInputSchema } from '@zenith/shared/analytics';
import { SEED_MENUS, SEED_RATE_LIMIT_RULES } from '@zenith/shared/seed';
import type { TrackEventInput } from '@zenith/shared/analytics';
import { userEvents } from '../../db/schema';
import { getLegacyEventsWithoutIdCount, resolveDistinctId } from './analytics.service';

const baseEvent = {
  sessionId: 'a6cb293e-13d1-4d64-8e58-3f2c9935e9c8',
  pagePath: '/dashboard',
};

describe('analytics P0 contracts', () => {
  it('keeps the legacy eventId omission compatible while validating new IDs', () => {
    expect(trackEventInputSchema.safeParse({ ...baseEvent, eventType: 'page_view' }).success).toBe(true);
    expect(trackEventInputSchema.safeParse({
      ...baseEvent,
      eventId: 'not-a-uuid',
      eventType: 'page_view',
    }).success).toBe(false);
    expect(getLegacyEventsWithoutIdCount()).toBeGreaterThanOrEqual(0);
  });

  it('enforces event-type-specific required fields', () => {
    expect(trackEventInputSchema.safeParse({ ...baseEvent, eventType: 'custom' }).success).toBe(false);
    expect(trackEventInputSchema.safeParse({ ...baseEvent, eventType: 'custom', eventName: 'order_submit' }).success).toBe(true);
    expect(trackEventInputSchema.safeParse({ ...baseEvent, eventType: 'perf', metricName: 'LCP' }).success).toBe(false);
    expect(trackEventInputSchema.safeParse({ ...baseEvent, eventType: 'perf', metricName: 'LCP', metricValue: 1200 }).success).toBe(true);
    expect(trackEventInputSchema.safeParse({ ...baseEvent, eventType: 'identify' }).success).toBe(false);
  });

  it('rejects oversized or overly broad event property bags', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, index]));
    expect(trackEventInputSchema.safeParse({
      ...baseEvent,
      eventType: 'custom',
      eventName: 'wide_event',
      properties: tooMany,
    }).success).toBe(false);
    expect(trackEventInputSchema.safeParse({
      ...baseEvent,
      eventType: 'custom',
      eventName: 'large_event',
      properties: { payload: 'x'.repeat(ANALYTICS_PROPERTIES_MAX_BYTES) },
    }).success).toBe(false);
  });

  it('requires an actual funnel condition and a deliverable enabled alert', () => {
    expect(funnelStepSchema.safeParse({ label: '任意事件' }).success).toBe(false);
    expect(funnelStepSchema.safeParse({ label: '支付成功', eventName: 'payment_success' }).success).toBe(true);
    expect(createErrorAlertRuleSchema.safeParse({ name: '无渠道规则' }).success).toBe(false);
    expect(createErrorAlertRuleSchema.safeParse({
      name: 'Webhook 规则',
      channels: ['webhook'],
      webhookUrl: 'https://example.com/alerts',
    }).success).toBe(true);
  });

  it('forces authenticated distinct IDs to the verified user identity', () => {
    const event: TrackEventInput = {
      ...baseEvent,
      eventType: 'page_view',
      distinctId: 'u:forged',
    };
    expect(resolveDistinctId(event, 42)).toBe('u:42');
    expect(resolveDistinctId(event, null)).toBe(baseEvent.sessionId);
  });

  it('forces authenticated member distinct IDs to the verified member identity (admin/member 互斥)', () => {
    const forgedAdminPrefix: TrackEventInput = { ...baseEvent, eventType: 'page_view', distinctId: 'u:forged' };
    const forgedMemberPrefix: TrackEventInput = { ...baseEvent, eventType: 'page_view', distinctId: 'm:forged' };
    // 已登录会员：强制 m:{memberId}，忽略客户端伪造的 distinctId
    expect(resolveDistinctId(forgedAdminPrefix, null, 7)).toBe('m:7');
    // 匿名：拒绝 u:/m: 伪造前缀，回退到 sessionId
    expect(resolveDistinctId(forgedAdminPrefix, null, null)).toBe(baseEvent.sessionId);
    expect(resolveDistinctId(forgedMemberPrefix, null, null)).toBe(baseEvent.sessionId);
    // 管理员优先于会员参数（理论上二者不会同时非空，但显式约定管理员优先）
    expect(resolveDistinctId(forgedAdminPrefix, 42, 7)).toBe('u:42');
  });

  it('declares the P0 persistence and seed controls', () => {
    expect(userEvents.eventId).toBeDefined();
    expect(getTableConfig(userEvents).indexes.map((index) => index.config.name)).toContain('user_events_event_id_uq');
    expect(SEED_RATE_LIMIT_RULES.map((rule) => rule.name)).toEqual(expect.arrayContaining([
      'analytics-ingest',
      'error-report',
    ]));
    expect(SEED_MENUS.some((menu) => menu.permission === 'analytics:clean')).toBe(false);
  });
});

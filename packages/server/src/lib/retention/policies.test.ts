/**
 * 数据保留策略声明的静态校验。
 *
 * 与 `permission-audit.test.ts` 同一思路：把「新增 append-only 表必须登记保留策略」
 * 这条约定变成可执行断言，避免新表悄悄逃过清理。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { toCamelCase } from 'drizzle-orm/casing';
import { RETENTION_POLICIES } from './policies';

const SCHEMA_DIR = join(import.meta.dirname, '../../db/schema');

/** 表名后缀命中即视为 append-only（一次写入、随业务量线性增长） */
const APPEND_ONLY_SUFFIX = /_(logs|records|events|runs|history|snapshots|deliveries|hits|samples)$/;

/**
 * 豁免清单：命中后缀但不应由保留框架清理的表，必须写明理由。
 * 新增豁免需要 reviewer 明确确认。
 */
const EXEMPT: Record<string, string> = {
  cms_content_tombstones: '内容删除墓碑，供站群增量同步比对，删除会导致下游漏同步',
  workflow_jobs: '待执行作业队列，终态行由工作流引擎自身回收',
  payment_settlement_records: '资金结算凭证，属于财务档案而非日志',
  member_point_transactions: '积分流水，用户可查全部历史，属于账务数据',
  member_wallet_transactions: '钱包流水，属于账务数据',
  report_fill_records: '填报业务数据，非日志',
  monitor_alert_rules: '告警规则配置表，非日志',
  iot_product_events: '物模型事件定义（产品配置），非日志；设备上报的事件流在 iot_device_events，已登记策略',
  terminal_recordings: '终端录屏，按天数与容量双策略回收，含对象存储副作用',
  report_materialization_snapshots: '物化快照，按行内 expires_at 与托管文件一并回收',
  cms_publish_artifacts: '发布产物索引，随发布任务级联回收（cms-publish-build 类型保留期 180 天）',
  cms_publish_logs: '发布日志（任务子项明细），随发布任务级联回收',
  cms_distribution_runs: '分发运行记录，随分发规则级联回收',
  cms_interaction_responses: '互动应答数据，属于业务数据',
  cms_feedback_history: '审稿批注哈希链账本（previousHash/hash 链式校验），迁移在数据库层拒绝 UPDATE/DELETE，保留框架无法清理且删除会破坏链式完整性校验',
  cms_form_submissions: '表单提交，属于业务数据',
  open_quota_alerts: '配额告警，由开放平台聚合任务按状态回收',
  analytics_daily_rollup: '按日聚合结果，体积远小于原始事件，是原始数据裁剪后的留存载体',
  identity_provider_sync_records: '身份源同步明细，随同步日志级联回收',
  wiki_review_records: '审核时间线，随文档级联删除（doc_id cascade），属于业务过程数据而非日志',
  entity_watch_events: '可靠待派发队列，成功后删除并随 domain_events 级联回收；不能在完成派发前按日志保留时间清理',
};

function collectTables(): Array<{ table: string; file: string }> {
  const found: Array<{ table: string; file: string }> = [];
  for (const entry of readdirSync(SCHEMA_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const content = readFileSync(join(SCHEMA_DIR, entry.name), 'utf8');
    for (const match of content.matchAll(/pgTable\('([a-z0-9_]+)'/g)) {
      found.push({ table: match[1], file: entry.name });
    }
  }
  return found;
}

describe('数据保留策略声明', () => {
  it('策略 key 唯一且与目标表名一致', () => {
    const keys = RETENTION_POLICIES.map((policy) => policy.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const policy of RETENTION_POLICIES) {
      expect(policy.key).toBe(policy.tableName);
    }
  });

  it('保留天数与批大小取值合法', () => {
    for (const policy of RETENTION_POLICIES) {
      expect(policy.defaultDays, `${policy.key} 默认保留天数`).toBeGreaterThan(0);
      expect(policy.defaultDays).toBeLessThanOrEqual(3650);
      if (policy.batchSize !== undefined) {
        expect(policy.batchSize).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('ageAndCap 模式必须同时声明分组列与保留条数', () => {
    for (const policy of RETENTION_POLICIES) {
      if (policy.mode !== 'ageAndCap') continue;
      expect(policy.capColumn, `${policy.key} 缺少 capColumn`).toBeTruthy();
      expect(policy.capLimit, `${policy.key} 缺少 capLimit`).toBeGreaterThan(0);
    }
  });

  it('custom 模式必须提供删除实现，其余模式不得携带', () => {
    for (const policy of RETENTION_POLICIES) {
      if (policy.mode === 'custom') {
        expect(policy.run, `${policy.key} 缺少 run 实现`).toBeTypeOf('function');
      } else {
        expect(policy.run, `${policy.key} 非 custom 模式不应声明 run`).toBeUndefined();
      }
    }
  });

  it('声明的表与时间列在 schema 中真实存在', () => {
    const tables = collectTables();
    const tableNames = new Set(tables.map((item) => item.table));
    const missing = RETENTION_POLICIES
      .filter((policy) => !tableNames.has(policy.tableName))
      .map((policy) => policy.tableName);
    expect(missing, `以下策略引用了不存在的表：${missing.join(', ')}`).toEqual([]);

    const schemaText = readdirSync(SCHEMA_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => readFileSync(join(SCHEMA_DIR, entry.name), 'utf8'))
      .join('\n');
    // 列名由 casing: 'snake_case' 从驼峰 key 派生：schema 源码中既可能出现显式蛇形列名
    // （派生不一致的边界情形），也可能只出现驼峰属性 key，两者任一命中即视为存在
    const badColumns = RETENTION_POLICIES
      .filter((policy) => !schemaText.includes(`'${policy.timeColumn}'`)
        && !new RegExp(`\\b${toCamelCase(policy.timeColumn)}:`).test(schemaText))
      .map((policy) => `${policy.key}.${policy.timeColumn}`);
    expect(badColumns, `以下策略的时间列在 schema 中不存在：${badColumns.join(', ')}`).toEqual([]);
  });

  it('所有 append-only 表都已登记保留策略或列入豁免', () => {
    const covered = new Set(RETENTION_POLICIES.map((policy) => policy.tableName));
    const uncovered = collectTables()
      .filter((item) => APPEND_ONLY_SUFFIX.test(item.table))
      .filter((item) => !covered.has(item.table) && !(item.table in EXEMPT))
      .map((item) => `${item.table} (${item.file})`);
    expect(
      uncovered,
      `以下 append-only 表未登记保留策略：\n${uncovered.join('\n')}\n`
      + '请在 lib/retention/policies.ts 中登记，或在本测试的 EXEMPT 中写明豁免理由。',
    ).toEqual([]);
  });

  it('豁免清单不包含已登记策略的表（避免重复声明）', () => {
    const covered = new Set(RETENTION_POLICIES.map((policy) => policy.tableName));
    const conflict = Object.keys(EXEMPT).filter((table) => covered.has(table));
    expect(conflict, `以下表既登记了策略又被豁免：${conflict.join(', ')}`).toEqual([]);
  });
});

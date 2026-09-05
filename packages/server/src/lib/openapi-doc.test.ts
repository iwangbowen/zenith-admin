import { readFile } from 'node:fs/promises';
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import * as dtos from './openapi-dtos';

/**
 * 回归防线：`/api/openapi.json`（Swagger / SDK 生成的唯一数据源）曾因递归 schema
 * 无限展开而整份返回 500。递归 schema 要生成 `$ref` 必须同时满足两个条件：
 * 1. `z.lazy` 的内部实例被缓存（shared 的 `lazyRecursive`），自引用命中同一实例；
 * 2. 递归 schema 自身注册了 refId（`.openapi('Xxx')` / `.meta({ id })`）。
 * 任一条件缺失都会栈溢出，且只在生成整份文档时才暴露。
 *
 * 实体 schema 由 `@zenith/shared` 各域契约定义，整份文档的生成由 `app.contract.test.ts`
 * 通过真实 `createApp()` 覆盖；本文件只逐个兜底仍以 DTO 形式导出的少数 schema
 * （不经契约 DSL 的 OAuth2 RFC 协议端点），并守住开放网关的 OpenAPIHono 装配。
 */
function isZodSchema(value: unknown): value is z.ZodType {
  return !!value && typeof (value as { safeParse?: unknown }).safeParse === 'function';
}

function generate(register: (app: OpenAPIHono) => void) {
  const app = new OpenAPIHono();
  register(app);
  return app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 'probe', version: '1' } });
}

/**
 * 逐个 DTO 生成一份完整文档，N 份文档 = N 次 zod→openapi 全量转换，实测约 6s。
 * 这是本用例固有的工作量（不是卡死），而 vitest 默认 5s 超时会稳定误杀，故显式放宽。
 */
const HEAVY_DOC_TIMEOUT_MS = 30_000;

describe('OpenAPI 文档生成', () => {
  const entries = Object.entries(dtos as Record<string, unknown>).filter(([, s]) => isZodSchema(s));

  it('导出了 DTO', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('每个 DTO 都能独立生成（递归 schema 不会栈溢出）', () => {
    const failed: string[] = [];
    for (const [name, schema] of entries) {
      try {
        generate((app) => app.openAPIRegistry.register(`Probe${name}`, schema as z.ZodType));
      } catch (err) {
        failed.push(`${name}: ${(err as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  }, HEAVY_DOC_TIMEOUT_MS);

  it('全部 DTO 汇总后仍能生成整份文档', () => {
    const doc = generate((app) => {
      for (const [name, schema] of entries) app.openAPIRegistry.register(`Probe${name}`, schema as z.ZodType);
    });
    expect(Object.keys(doc.components?.schemas ?? {}).length).toBeGreaterThanOrEqual(entries.length);
  }, HEAVY_DOC_TIMEOUT_MS);

  it('开放网关必须是 OpenAPIHono，否则子路由不会进入文档', async () => {
    // OpenAPIHono.route() 只在父子同为 OpenAPIHono 时合并子路由的 openAPIRegistry；
    // 父级退化成普通 Hono 会让 open-cms 的定义被静默丢弃（端点可访问但 Swagger 里没有）。
    const source = await readFile(new URL('../routes/open-platform/open-gateway.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/const router = new OpenAPIHono\(/);
    expect(source).not.toMatch(/const router = new Hono\(/);
  });
});

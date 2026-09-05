import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * 整份 `/api/openapi.json` 的生成（含递归 schema 的 `$ref` 收敛）由 `app.contract.test.ts`
 * 通过真实 `createApp()` 覆盖；本文件只守住开放网关的 OpenAPIHono 装配。
 */
describe('OpenAPI 文档装配', () => {
  it('开放网关必须是 OpenAPIHono，否则子路由不会进入文档', async () => {
    // OpenAPIHono.route() 只在父子同为 OpenAPIHono 时合并子路由的 openAPIRegistry；
    // 父级退化成普通 Hono 会让 open-cms 的定义被静默丢弃（端点可访问但 Swagger 里没有）。
    const source = await readFile(new URL('../routes/open-platform/open-gateway.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/const router = new OpenAPIHono\(/);
    expect(source).not.toMatch(/const router = new Hono\(/);
  });
});

import { OpenAPIHono } from '@hono/zod-openapi';
import type * as z from 'zod';
import type { Operation } from '@zenith/shared/core';
import {
  SETTINGS_MODULES,
  SETTINGS_MODULE_KEYS,
  settingsContract,
  settingsGetOp,
  settingsUpdateOp,
  type SettingsModuleKey,
  type SettingsOf,
} from '@zenith/shared/settings';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { redactBody } from '../../lib/sanitize';
import {
  getMySettings,
  getPublicSettings,
  getSettingsEnvelope,
  listSettingsModules,
  saveSettings,
} from '../../lib/settings';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';

const settingsRoutes = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(settingsContract.list, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listSettingsModules(c.get('user'))), 200),
});

const publicRoute = defineContractRoute(settingsContract.public, {
  middleware: [],
  handler: async (c) => c.json(okBody(await getPublicSettings(c.req.valid('query').tenantCode)), 200),
});

const meRoute = defineContractRoute(settingsContract.me, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getMySettings()), 200),
});

/**
 * 逐模块 get / update 的**类型视图**：运行时仍使用契约上的精确操作对象（OpenAPI 文档、入参校验、
 * 响应 schema 全部逐模块强类型），这里只是把 TS 视图放宽到「响应任意、请求体 { version, data }」，
 * 让 13 个模块共用同一个循环装配，而不是复制 26 段只差模块名的路由定义。
 * 响应形状由 `lib/settings` 单一代码路径产出，并由 `settings.test.ts` / 路由测试在运行期校验。
 */
type WideGetOp = Operation<'get', string, undefined, undefined, undefined, z.ZodType<unknown>, 'json', undefined>;
type WideUpdateOp = Operation<'put', string, undefined, undefined, z.ZodType<{ version: number; data: unknown }>, z.ZodType<unknown>, 'json', undefined>;

function moduleRoutes(module: SettingsModuleKey) {
  const def = SETTINGS_MODULES[module];
  const read = guard({ feature: def.feature, permission: def.readPermission ?? undefined });
  const write = guard({
    feature: def.feature,
    permission: def.writePermission,
    audit: { module: '系统设置', description: `更新「${def.title}」设置` },
  });
  const getOp = settingsGetOp(module) as unknown as WideGetOp;
  const updateOp = settingsUpdateOp(module) as unknown as WideUpdateOp;
  return [
    defineContractRoute(getOp, {
      middleware: [authMiddleware, read] as const,
      handler: async (c) => c.json(okBody(await getSettingsEnvelope(module)), 200),
    }),
    defineContractRoute(updateOp, {
      middleware: [authMiddleware, write] as const,
      handler: async (c) => {
        // 审计 before / after 快照不经 redactBody，这里主动脱敏一次作为纵深防御（注册表自检已禁止凭证类字段）
        const before = await getSettingsEnvelope(module);
        setAuditBeforeData(c, redactBody(before.effective));
        const body = c.req.valid('json');
        const saved = await saveSettings(module, c.get('user'), { version: body.version, data: body.data as SettingsOf<typeof module> });
        return c.json(okBody(saved, '保存成功'), 200);
      },
    }),
  ] as const;
}

settingsRoutes.openapiRoutes([listRoute, publicRoute, meRoute] as const);
for (const module of SETTINGS_MODULE_KEYS) {
  settingsRoutes.openapiRoutes(moduleRoutes(module));
}

export default settingsRoutes;
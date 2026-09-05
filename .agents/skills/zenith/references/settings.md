# 运行时设置接入参考

> **触发场景**：功能需要一个「后台可改、不重启即生效、影响系统行为」的开关 / 阈值 / 策略——
> 登录验证码、上传大小上限、审批阈值、录屏开关、AI 配额等。
> 这类值**禁止**新建 KV 配置表、逐项种子、环境变量兜底或存进字典，一律进 `packages/shared/src/settings/` 的模块注册表。
>
> 完整机制（存储、解析、缓存、跨实例失效、作用域、投影、API）见 [docs/backend/settings.md](../../../../docs/backend/settings.md)；
> 硬约束见 [constraints.md](./constraints.md)（Shared / Service / Route 层）与 [constraints-frontend.md](./constraints-frontend.md)。
>
> 不属于运行时设置：进程级参数（数据库、Redis、端口、多租户开关）走 `config.ts` 环境变量；
> 有列表语义的业务数据（字典、限流规则、存储配置）走常规 CRUD。

---

## 先判定三件事

| 问题 | 结论 |
| --- | --- |
| 归哪个模块？ | 现有 13 个模块见 `registry.ts`（`auth` / `identitySecurity` / `ui` / `files` / `terminal` / `member` / `ai` / `rules` / `payment` / `workflow` / `ipAccess` / `drive` / `wiki`）。能归入现有模块就加字段；只有全新业务域才建新模块 |
| 作用域？ | 读者是后台任务、cron、无租户上下文的中间件 → **必须 `platform`**（tenant 作用域在无租户时静默退回平台值）；只在带用户的请求链路读取且租户确需独立策略 → `tenant` |
| 谁能看？ | 只有管理员读 → 不声明 `visibility`；登录用户界面要用（布局开关、密码提示）→ `authenticated`；登录前页面要用 → `public`。可见字段禁止承载任何敏感值 |

---

## A. 给现有模块加字段

1. 在 `packages/shared/src/settings/modules/{module}.ts` 的 schema 上加叶子：

   ```ts
   uploadMaxSizeMb: z.int().min(0).max(102_400).default(0)
     .meta({ title: '单文件大小上限（MB）', description: '0 表示不限制' }),
   ```

   - 叶子**必须** `.default()`；新增嵌套对象**必须** `.prefault({})` 并在对象上 `.meta({ title })`
   - 数组用 `.default(() => [...])`；可空用 `.nullable().default(null)`
   - 通用设置页按类型自动渲染：boolean → 开关、number → 数字输入（min / max / 整数取自 schema）、enum → 下拉、
     string → 输入框、string[] → 标签输入、嵌套对象 → 分组。枚举展示文案在 `SettingsPage.tsx` 的 `ENUM_LABELS` 登记
2. 需要匿名 / 登录可见：模块 `visibility` 加该字段，并同步 `contracts.ts` 的 `publicSettingsSchema` / `mySettingsSchema`
   （`.pick({...})`）——`settings.test.ts` 断言两处一致
3. 运行 `npm run test -w @zenith/shared`，再 `npm run build -w @zenith/shared`（server / web 类型检查依赖 dist）
4. 服务端读取：`const { uploadMaxSizeMb } = await getSettings('files');`
5. 有专用页面的模块（`identitySecurity` / `ipAccess` / `drive` / `wiki`）在对应页面补一行 `SettingRow`；其余模块页面零改动
6. Demo 模式无需改动：Mock 默认值来自 schema

## B. 新建模块

1. `packages/shared/src/settings/modules/{module}.ts`：

   ```ts
   export const xxxSettingsSchema = z.object({ ... });
   export type XxxSettings = z.output<typeof xxxSettingsSchema>;
   export const xxxSettingsModule = defineSettingsModule({
     schema: xxxSettingsSchema,
     title: '…', description: '…',
     scope: 'platform',
     feature: 'xxx',                       // 与该业务域路由挂载的 { feature } 一致；无门控则省略
     readPermission: 'system:setting:view',
     writePermission: 'system:setting:update',
     sort: 140,
   });
   ```

2. `registry.ts`：`SETTINGS_MODULES` 加 `xxx: xxxSettingsModule`，`SETTINGS_MODULE_PATHS` 加 `xxx: '/xxx'`（kebab-case，不得为 `public` / `me`）
3. `contracts.ts`：`const xxx = moduleOps('xxx');` 并在 `settingsContract` 加 `getXxx: xxx.get, updateXxx: xxx.update`
4. `index.ts` 导出模块文件；`npm run test -w @zenith/shared` 会跑 `validateSettingsRegistry()`（默认值幂等、路径唯一、可见性字段存在、敏感字段名）
5. 服务端 `routes/platform/settings.ts` 循环注册表，**无需改路由**；`app.contract.test.ts` 快照需 `-u` 重新生成
6. 只有需要专用页面（表单结构复杂、带联动 / 预览）才写页面并在模块声明 `page: '/xxx/settings'`；否则通用设置页直接可用
7. 使用域专属权限码（如 `drive:setting:view`）时在该域菜单种子下挂对应按钮；用通用 `system:setting:*` 则无需加菜单

## C. 服务端读取规则

```ts
// 平台作用域
const settings = await getSettings('terminal');
// 租户作用域：显式传入所属租户（订单 / 用户 / 会员的 tenantId），不要靠请求上下文推断
const policy = await getSettings('identitySecurity', { tenantId: user.tenantId });
```

- **事务内禁止调用** `getSettings*`：先在 `db.transaction()` 外读取，再以参数传给事务函数（见 `drive-upload.service.ts` 的 `settings` 参数）
- 不要 `?? 默认值`、不要缓存到模块级变量、不要读环境变量兜底
- 写入只经 `saveSettings()`（路由已封装），业务代码不直接改 `system_settings`

## D. 前端读取规则

| 场景 | 用 |
| --- | --- |
| 布局 / 页面里的开关（水印、反馈入口、录屏、审批开关） | `useMySettings()` → `data?.ui?.…`；带 License 门控的段可能缺省 |
| 登录 / 注册 / 改密页 | `usePublicSettings(tenantCode)`；密码提示用 `validatePassword` / `formatPasswordPolicyHint`（`@zenith/shared/settings`） |
| 管理某模块（专用页面） | `useSettings(module)` 拿信封（`effective` / `inherited` / `overriddenPaths` / `version`），`useSaveSettings(module)` 整体替换；409 → 提示后 `refetch` |
| 保存后有别的域受影响（如网盘配额影响空间列表） | `useSaveSettings(module, (qc, saved) => …)` 的 `extraInvalidate` 追加失效 |

## E. Mock

`mocks/handlers/settings.ts` 已覆盖全部模块的读写、`list` / `public` / `me`；新增模块自动生效。
其它 handler 需要读设置时用 `getMockSettings(module)`（`mocks/data/settings.ts`）或已有镜像（`mockDriveSettings` / `mockWikiSettings`），不要再写字面量。

## 完成核对

- [ ] 叶子 `.default()`、嵌套 `.prefault({})`、`.meta({ title, description })` 齐全
- [ ] `scope` 与读者一致（后台任务读 → platform）
- [ ] `visibility` 与 `publicSettingsSchema` / `mySettingsSchema` 同步（如有）
- [ ] `npm run test -w @zenith/shared` 通过；`npm run build -w @zenith/shared` 后 server / web 类型检查通过
- [ ] 服务端读取不在事务内；无 `??` 默认值、无环境变量兜底
- [ ] 通用设置页或专用页面能看到并保存该字段；Demo 模式同样可用

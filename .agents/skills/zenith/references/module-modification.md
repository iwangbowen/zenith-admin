# 修改现有模块流程

修改已有模块（而非从零创建）时，按场景选择步骤序列。Step 编号沿用
[SKILL.md](../SKILL.md) 的 CRUD 流程，代码模板见对应主题文件。

改完按[修改后的验证](#修改后的验证)自检。

---

## 场景 1：添加新字段

**后端**

1. **Schema**（Step 1）：在 `db/schema/{业务域}.ts` 的 `xxxs` 表中添加字段
2. **迁移**（Step 2）：`npm run db:generate && npm run db:migrate`
3. **Zod Schema**（Step 3）：在 `shared/src/{业务域}/validation.ts` 的 `createXxxSchema` 中添加
   （`updateXxxSchema` 由 `partialForUpdate(createXxxSchema)` 自动派生，新字段的 `.default()` 只作用于创建）
4. **契约实体**（Step 4）：在 `shared/src/{业务域}/contracts/xxxs.ts` 的 `xxxSchema` 中添加字段——
   `Xxx` 类型、路由响应检查、OpenAPI 与 Mock 类型随之更新，无需再改其他声明
5. **Service**（Step 5）：在 `mapXxx()` 中映射，在 `createXxx()` / `updateXxx()` 中处理写入

**前端**

- **域 hooks**（Step 8a）：字段进入列表筛选条件时在契约的 `xxxListQuery` 中添加（hooks 的参数类型随之更新）；
  字段引入了新查询（统计、关联明细）时按 [query-cache.md → key 结构设计](./query-cache.md#key-结构设计)
  挂到合适前缀下，并确认已有 mutation 的 `onSuccess` 覆盖到它
- **页面**（Step 8b）：`columns` 加列（新列写固定 `width`，弹性主列仍只有一个）、Modal 的 `<Form>` 加输入组件；
  需要搜索时在 `SearchParams` 与 `SearchToolbar` 中添加；给操作列增删动作后按
  [ui-patterns.md → 操作列](./ui-patterns.md#操作列) 重算 `width` 并复核内联动作数
- **回填检查**（Step 8a）：工厂生成的 `useSave` 不做回填（见 [query-cache.md](./query-cache.md#标准-crud-与手写-mutation-的边界)），
  新增字段无需额外判断。仅当域内**手写**了带回填的 mutation 时，才按
  [query-cache.md → 落地要求](./query-cache.md#落地要求)重新判断新字段是否让写接口响应与详情接口不再同源

**Mock**（如启用）：在 `mocks/data/xxxs.ts` 与 `mocks/handlers/xxxs.ts` 中添加字段。

---

## 场景 2：修改 API 接口

**改请求参数**

1. 请求体：修改 `shared/src/{业务域}/validation.ts` 中的 schema（Step 3）；查询 / 路径参数：修改契约操作的
   `query` / `params`（Step 4）——路由校验、前端调用类型与 Mock 解析同步生效
2. 更新 service 函数的参数类型与处理逻辑（Step 5）

**改响应格式**

1. 修改契约实体 `xxxSchema` 或操作的 `response`（Step 4）
2. 更新 `mapXxx()` 的返回字段（Step 5）——handler 的 `c.json(okBody(...))` 按契约类型检查，不一致直接编译失败

**新增 API 端点**

1. 在契约中添加操作 `op.xxx(...)`（Step 4）
2. 在路由文件中 `defineContractRoute(xxxContract.op, { middleware, handler })`，并注册进 `router.openapiRoutes([...])`（Step 6）
3. 在 service 中添加对应业务函数（Step 5）
4. 刷新 `/api/docs` 验证新接口出现
5. 在 `hooks/queries/xxxs.ts` 中用 `useApiQuery` / `useApiMutation(op, { invalidate })` 暴露，失效策略按
   [query-cache.md 的缓存一致性契约](./query-cache.md#缓存一致性契约)选择（Step 8a）
6. 启用 Demo 模式时同步 `mock(xxxContract.op, ...)`（Step 11）

---

## 场景 3：添加关联关系

### 多对一（FK）

1. **Schema**（Step 1）：加外键字段
   `yyyId: integer().references(() => yyys.id, { onDelete: 'set null' })`。
   可空普通关联默认 `set null`；仅当 Yyy 对 Xxx 具有明确生命周期所有权时才使用 `cascade`
2. **Relations**（Step 1）：在 `db/schema/relations.ts` 添加或更新 `xxxsRelations`
3. **迁移**（Step 2）
4. **Zod Schema**（Step 3）：在创建 schema 中添加 `yyyId`
5. **Service**（Step 5）：`mapXxx()` 用 RQB 读关联数据（`with: { yyy: { columns: { name: true } } }`）；
   写入时校验外键存在（`ensureYyyExists()`）
6. **契约实体**（Step 4）：添加关联字段（如 `yyyName: z.string().nullable()`）
7. **前端**（Step 8）：表格列显示关联字段；表单用 `<Form.Select>`，选项**复用 Yyy 域导出的共享
   lookup hook**（`useAllYyys`），见 [query-cache.md → 下拉源必须归属所有者域](./query-cache.md#下拉源必须归属所有者域)。
   若 Yyy 的增删改会改变本列表的展示，在 Yyy 域 mutation 的 `onSuccess` 中补上对应失效

### 多对多

1. **Schema**（Step 1）：创建联结表 `xxxYyys`，在 `relations.ts` 添加两侧 relations
2. **迁移**（Step 2）
3. **Zod Schema**（Step 3）：在 `createXxxSchema` 添加 `yyyIds: z.array(z.number().int()).default([])`
   （`updateXxxSchema` 经 `partialForUpdate` 派生后该字段无默认值，省略即不改动关联；
   服务层只在 `yyyIds !== undefined` 时重写联结表）
4. **Service**（Step 5）：`db.transaction()` 包裹主表写入 + 关联写入；实现
   `setXxxYyys(executor, xxxId, yyyIds)`（先删后插）；RQB 查询用 `with: { xxxYyys: { with: { yyy: true } } }`
5. **契约实体**（Step 4）：添加 `yyys` 嵌套对象与 `yyyIds` 数组
6. **前端**（Step 8）：表单用 `<Form.Select mode="multiple">`，选项复用所有者域的共享 lookup hook
7. **失效链路**（Step 8a）：子资源写入失效对应子键；若列表渲染了该子资源的派生列（如 `userCount`），
   按契约的「子资源写入」一行处理，一并失效 `lists`

---

## 场景 4：修改枚举值

> pgEnum / TS union type / Zod enum 三端必须同步。

1. **常量数组**（Step 3-4）：在 `shared/src/{业务域}/constants.ts` 的 `XXX_TYPES` 中添加新值，
   同步 `XXX_LABELS` / `XXX_OPTIONS`
2. **pgEnum**（Step 1）：在 `db/schema/{业务域}.ts` 的 `pgEnum` 中添加新值
3. **迁移**（Step 2）：Drizzle 会生成 `ALTER TYPE ADD VALUE`
4. **前端字典**（Step 8）：枚举值在字典中展示时，确认 `useDictItems` 或字典种子包含新值
5. **MSW Mock**（Step 11）：如需要，更新 mock 数据中的枚举值

`validation.ts` 通过 `z.enum(XXX_TYPES)` 引用常量数组，无需单独改动。

---

## 场景 5：删除字段或表

按依赖倒序移除，避免中间状态编译不过：

1. **前端**（Step 8）：先从页面、表单、表格列中移除
2. **Service**（Step 5）：`mapXxx()` 与业务逻辑
3. **Shared**（Step 3-4）：`validation.ts` 与契约 `contracts/xxxs.ts`
4. **Schema**（Step 1）→ **迁移**（Step 2）
5. **MSW Mock**（Step 11）

> ⚠️ 删除数据库字段不可逆。生产环境建议先标记废弃，观察一段时间后再删除。

---

## 修改后的验证

按 [SKILL.md → CRUD 完成标准](../SKILL.md#crud-完成标准) 逐项核对（迁移 / build / lint / 测试 / 页面实测 / Mock / 约束对照），另加两项：

- [ ] `/api/docs` 中接口定义已更新
- [ ] 操作日志 diff 正常显示变更字段；写接口返回 `okBody(null, ...)` 但需展示变更后状态时，
      已调用 `setAuditAfterData(c, after)`（见 [backend-patterns.md](./backend-patterns.md#操作日志变更-diff)）

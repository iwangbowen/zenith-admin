# 修改现有模块流程

当需要修改已有模块时（而非从零创建），按以下场景选择对应的 checklist。

> **占位符约定**：`xxx` = 小写（表名、API 路径、文件名）；`Xxx` = 大驼峰（TypeScript 类型、组件名）。

---

## 场景 1：给现有模块添加新字段

### 后端

1. **Schema**（Step 1）：在 `packages/server/src/db/schema/` 对应业务域文件的 `xxxs` 表中添加新字段
2. **迁移**（Step 2）：`npm run db:generate && npm run db:migrate`
3. **Zod Schema**（Step 3）：在 `packages/shared/src/validation.ts` 的 `createXxxSchema` 和 `updateXxxSchema` 中添加新字段
4. **TS Interface**（Step 4）：在 `packages/shared/src/types.ts` 的 `Xxx` 接口中添加新字段
5. **DTO**（Step 6）：在 `packages/server/src/lib/dtos/xxx.ts` 的 `XxxDTO` 中添加新字段
6. **Service mapXxx**（Step 5）：在 `mapXxx()` 函数中映射新字段
7. **Service 写入逻辑**（Step 5）：在 `createXxx()` / `updateXxx()` 中处理新字段的写入

### 前端

- **表格列**（Step 8）：在 `XxxPage.tsx` 的 `columns` 中添加新列
- **表单字段**（Step 8）：在 Modal 的 `<Form>` 中添加新输入组件
- **搜索筛选**（Step 8）：如需要搜索，在 `SearchParams` 和 `SearchToolbar` 中添加

### Mock（如需要）

- **MSW 数据**（Step 11）：在 `mocks/data/xxxs.ts` 和 `mocks/handlers/xxxs.ts` 中添加新字段

---

## 场景 2：修改 API 接口

### 修改请求参数

1. **Zod Schema**（Step 3）：修改 `packages/shared/src/validation.ts` 中的 schema
2. **Route**（Step 6）：确认路由的 `request:`  schema 引用了正确的 schema
3. **Service**（Step 5）：更新 service 函数的参数类型和处理逻辑

### 修改响应格式

1. **DTO**（Step 6）：修改 `packages/server/src/lib/dtos/xxx.ts` 中的 DTO
2. **Service mapXxx**（Step 5）：更新 `mapXxx()` 的返回字段
3. **TS Interface**（Step 4）：同步修改 `packages/shared/src/types.ts`
4. **前端类型**（Step 8）：前端使用 `@zenith/shared` 的 `Xxx` 类型，自动同步

### 新增 API 端点

1. **Route**（Step 6）：在路由文件中添加新的 `defineOpenAPIRoute`
2. **Service**（Step 5）：在 service 中添加对应的业务函数
3. **路由注册**：在 `router.openapiRoutes([...])` 中注册新路由
4. **Swagger**：刷新 `/api/docs` 验证新接口出现

---

## 场景 3：添加关联关系

### 多对一（FK）关联

1. **Schema**（Step 1）：在 `xxxs` 表中添加外键字段 `yyyId: integer('yyy_id').references(() => yyys.id, { onDelete: 'cascade' })`
2. **Relations**（Step 1）：在 `schema.ts` 末尾添加或更新 `xxxsRelations`
3. **迁移**（Step 2）：`npm run db:generate && npm run db:migrate`
4. **Zod Schema**（Step 3）：在创建/更新 schema 中添加 `yyyId` 字段
5. **Service**（Step 5）：
   - 在 `mapXxx()` 中，使用 RQB 读取关联数据（`with: { yyy: { columns: { name: true } } }`）
   - 在 `createXxx()` / `updateXxx()` 中，写入时校验外键是否存在（`ensureYyyExists()`）
6. **DTO**（Step 6）：在 DTO 中添加关联字段（如 `yyyName: z.string().nullable()`）
7. **前端**（Step 8）：
   - 表格列中添加关联字段显示
   - 表单中添加 `<Form.Select>` 下拉选择，`useEffect` 加载关联数据

### 多对多关联

1. **Schema**（Step 1）：创建联结表 `xxxYyys`，添加 `xxxsRelations` 和 `yyysRelations`
2. **迁移**（Step 2）：`npm run db:generate && npm run db:migrate`
3. **Zod Schema**（Step 3）：在创建/更新 schema 中添加 `yyyIds: z.array(z.number().int()).default([])`
4. **Service**（Step 5）：
   - 使用 `db.transaction()` 包裹主表写入 + 关联写入
   - 实现 `setXxxYyys(executor, xxxId, yyyIds)` 辅助函数（先删后插）
   - RQB 查询时使用 `with: { xxxYyys: { with: { yyy: true } } }`
5. **DTO**（Step 6）：在 DTO 中添加 `yyys` 嵌套对象和 `yyyIds` 数组
6. **前端**（Step 8）：表单中使用 `<Form.Select mode="multiple">` 多选

---

## 场景 4：修改枚举值

> **关键**：pgEnum / TS union type / Zod enum 三端必须同步修改。

1. **pgEnum**（Step 1）：在 `schema.ts` 的 `pgEnum` 中添加新值
2. **迁移**（Step 2）：`npm run db:generate && npm run db:migrate`（Drizzle 会生成 `ALTER TYPE ADD VALUE`）
3. **Zod enum**（Step 3）：在 `validation.ts` 的 zod schema 中同步 `z.enum([...])`
4. **TS union type**（Step 4）：在 `types.ts` 的接口中同步 union type
5. **前端字典**（Step 8）：如果枚举值在字典中展示，确认 `useDictItems` 或 `statusItems` 包含新值
6. **MSW Mock**（Step 11）：如需要，更新 mock 数据中的枚举值

---

## 场景 5：删除字段或表

1. **前端先行**（Step 8）：先从前端页面、表单、表格列中移除相关代码
2. **Route**（Step 6）：从路由 DTO 中移除字段
3. **Service**（Step 5）：从 `mapXxx()` 和 service 逻辑中移除
4. **Shared**（Step 3-4）：从 `validation.ts` 和 `types.ts` 中移除
5. **Schema**（Step 1）：从 `schema.ts` 中移除字段或表定义
6. **迁移**（Step 2）：`npm run db:generate && npm run db:migrate`
7. **MSW Mock**（Step 11）：从 mock 数据和 handler 中移除

> ⚠️ **注意**：删除数据库字段是不可逆操作。生产环境建议先标记为废弃，观察一段时间后再删除。

---

## 修改后的验证清单

- [ ] `npm run build` 无报错
- [ ] Swagger 文档（`/api/docs`）中接口定义已更新
- [ ] 前端页面正常渲染新字段/新布局
- [ ] MSW Mock 数据已同步（如启用 Demo 模式）
- [ ] 操作日志 diff 正常显示变更字段；若写接口返回 `okBody(null, ...)` 但需要展示变更后状态（如成员/角色/菜单/数据权限分配），已在写操作后调用 `setAuditAfterData(c, after)`

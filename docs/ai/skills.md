# Zenith Skill

Zenith Skill 是针对 Zenith Admin 的专属开发辅助工作流，内置于 `.agents/skills/zenith/`。在支持 Skills 的 AI 工具（如 GitHub Copilot）中，可通过自然语言直接触发，自动完成全栈 CRUD 模块的代码生成。

---

## 触发方式

在 AI 对话中直接描述功能需求，AI 会自动识别并加载 Skill：

```text
实现「商品分类」的 CRUD 管理功能
```

```text
新增「员工合同管理」模块，包含合同类型、合同编号、开始日期、结束日期字段
```

---

## CRUD 生成流程

### Step 0：信息收集与确认

AI 会在生成代码之前，按照 `references/step0-checklist.md` 主动向你确认以下信息：

| 信息项 | 说明 |
| --- | --- |
| 模块中文名 | 如「商品分类」 |
| 实体英文名 | 如 `Category` / `category` |
| API 路径前缀 | 如 `/api/categories` |
| 主要字段列表 | 字段名、类型、是否必填 |
| 父菜单 ID | 菜单挂载位置（如系统管理 = id:2） |
| 是否需要 MSW Mock | 是否支持 Demo 演示无后端运行 |
| 可选能力 | 状态字段、关联实体、特殊枚举、数据权限、租户隔离、批量操作、数据导出等 |

### Step 1–11：自动代码生成

| 步骤 | 生成内容 | 文件位置 |
| --- | --- | --- |
| 1 | 数据库 Schema | `packages/server/src/db/schema/{业务域}.ts`（relations 在 `relations.ts`） |
| 2 | 数据库迁移 | `npm run db:generate` + `npm run db:migrate` |
| 3 | 共享 Zod Schema | `packages/shared/src/validation.ts` |
| 4 | 共享 TypeScript 类型 | `packages/shared/src/types.ts` |
| 5 | Service 层（业务逻辑、数据映射、前置校验） | `packages/server/src/services/xxx.service.ts` |
| 6 | Hono 路由（CRUD + 分页 + 筛选）+ 实体 DTO | `packages/server/src/routes/`；DTO 放 `packages/server/src/lib/dtos/`（按业务域拆分），barrel：`openapi-dtos.ts` |
| 7 | 注册路由（OpenAPI Spec 同步自动生成） | `packages/server/src/index.ts` |
| 8 | 前端列表页（搜索 + 表格 + 弹窗） | `packages/web/src/pages/` |
| 9 | 菜单种子数据（菜单 + 按钮权限） | `packages/shared/src/seed-data.ts` |
| 10 | 数据库种子数据 | `packages/server/src/db/seed.ts` |
| 11 | MSW Mock（按需，仅 Demo 演示模式） | `packages/web/src/mocks/` |

---

## 最佳实践

### 好的需求描述示例

```text
实现「合同管理」CRUD，字段包括：
- 合同编号 string 必填唯一
- 员工（关联 users 表，外键 userId）
- 合同类型 枚举：正式/实习/外包
- 开始日期 date 必填
- 结束日期 date 必填
- 备注 text 可选

菜单挂在「系统管理」下（父菜单 id:2），需要 MSW Mock
```

### 关键提示

- **明确字段**：提前说明字段名、类型、约束，减少来回确认次数
- **明确关联**：外键关联（如关联部门、用户）需要提前说明
- **说清菜单位置**：告知页面挂载在哪个一级菜单下

### 修改现有模块

给已有模块加字段、修改接口、添加关联、调整枚举或删除字段时，Skill 会读取 `references/module-modification.md`，按对应场景同步检查 Schema、迁移、共享类型、DTO、Service、路由、前端页面与 MSW Mock。

### 发布新版本

发布版本时，Skill 会读取 `references/release.md`，按版本号确认、package 版本同步、lock 文件同步、构建验证、Changelog、提交与 tag 推送、GitHub Actions 检查的流程执行。

---

## 后端路由规范

生成的 Hono 路由遵循以下约定（详见 [API 规范](/backend/api-conventions)）：

- `GET    /api/{resource}`      — 分页列表，支持多字段筛选
- `POST   /api/{resource}`      — 新增
- `PUT    /api/{resource}/:id`  — 更新
- `DELETE /api/{resource}/:id`  — 删除

所有路由通过 `guard` 中间件自动记录操作日志。如需记录操作前/后数据 diff，需在 PUT/DELETE handler 中调用 `setAuditBeforeData()`，详见[操作日志与变更记录](/backend/audit-log-changes)。

---

## 前端页面规范

生成的列表页遵循统一布局约定（详见 [UI 规范](/frontend/ui-conventions)）：

- 搜索区统一使用 `SearchToolbar`；筛选/操作较多时使用结构化模式，移动端只露出关键词、查询、新增等高频入口，其余筛选进底部抽屉，低频操作进更多菜单
- 使用 `<ConfigurableTable bordered ... />` 数据表格
- 操作列使用纯文字 borderless 按钮，右侧固定（`fixed: 'right'`）
- 状态列紧靠操作列左侧并右侧固定
- 新增/编辑使用 `Modal` 弹窗，删除使用 `Popconfirm` 二次确认

---

## Skill 文件结构

```text
.agents/skills/zenith/
├── SKILL.md               # 工作流入口与步骤定义
└── references/
    ├── crud-backend.md    # 后端路由完整代码模板（含 diff 记录）
    ├── crud-frontend.md   # 前端列表页完整代码模板
    ├── crud-mock.md       # MSW Mock handler 代码模板
    ├── seed-config.md     # 菜单与种子数据配置参考
    ├── constraints.md     # 核心规范约束清单
    ├── module-modification.md # 修改现有模块流程
    ├── release.md         # 版本发布流程
    ├── troubleshooting.md # 调试与排错指南
    └── step0-checklist.md # 信息收集问卷
```

维护者在修改代码规范后，应同步更新对应的 `references/` 模板文件，确保后续 AI 生成的代码始终与项目保持一致。

# AI 辅助开发

Zenith Admin 专为 AI 辅助开发场景设计，提供了一套开箱即用的 AI 集成机制，让 GitHub Copilot、Claude、Cursor 等 AI 工具在生成代码时能够精准理解项目约定。

---

## 核心文件

| 文件 / 目录 | 用途 |
| --- | --- |
| `AGENTS.md` | 项目根目录，AI 工具的"项目说明书"，包含架构约定、常用命令、陷阱提示 |
| `.claude/skills/zenith/SKILL.md` | Zenith CRUD Skill 入口，描述完整的模块开发工作流 |
| `.claude/skills/zenith/references/` | Skill 参考文档，包含后端、前端、Mock、菜单种子的完整代码模板 |

---

## 工作方式

```
你（自然语言需求）
    ↓
AI 工具读取 AGENTS.md（理解项目约定）
    ↓
AI 工具加载 Zenith Skill（获取 CRUD 生成工作流）
    ↓
依次生成：Schema → 迁移 → 类型 → 路由 → 页面 → Mock
```

- **[AGENTS.md](./agents)** — 维护项目上下文，让 AI 像熟悉项目的老队员一样工作
- **[Zenith Skill](./skills)** — 一句话触发完整 CRUD 模块生成（10 步自动化流程）

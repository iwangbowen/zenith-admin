# 发布新版本流程

## 触发时机

用户说「发布 vX.Y.Z」「准备 X.Y.Z 版本」「release X.Y.Z」时，按此流程执行。

---

## Step 1：确认版本号

- 格式必须为 `x.y.z`（语义化版本），向用户确认版本号
- 运行 `git log <上一版本tag>..HEAD --oneline` 查看本次变更提交，用于撰写 Changelog

---

## Step 2：更新 package.json 版本号

同步更新以下 **4 个文件**的 `"version"` 字段：

- 根 `package.json`
- `packages/server/package.json`
- `packages/web/package.json`
- `packages/shared/package.json`

---

## Step 3：同步 package-lock.json

版本号写入后，在项目根目录执行以下命令，使 `package-lock.json` 与 `package.json` 保持一致：

```bash
npm install --package-lock-only
```

> `--package-lock-only` 仅更新 lock 文件，不安装/变更 node_modules，速度快且安全。

---

## Step 4：运行测试

提交前必须确认全部测试通过：

```bash
npm test
```

该命令依次运行 server 与 web 两个包的全部 vitest 测试，全部通过（退出码 0）后再进行下一步。如有失败须先修复再继续。

同时建议运行核心资金链路 DB 集成测试（积分 / 钱包 / 优惠券的「事务 + 乐观锁」并发正确性，默认跳过，需本地 PostgreSQL 可用）：

```powershell
# PowerShell（在 packages/server 目录执行）
$env:MEMBER_FUNDS_DB_IT='1'; npx vitest run src/services/member-funds.it.test.ts
```

```bash
# Bash（在 packages/server 目录执行）
MEMBER_FUNDS_DB_IT=1 npx vitest run src/services/member-funds.it.test.ts
```

> 本次发布涉及积分 / 钱包 / 优惠券 / 支付相关改动时，该集成测试**必须**运行并通过；其余改动 PG 不可用时可跳过。

---

## Step 5：本地构建验证

提交前必须确认本地构建通过，避免 CI 失败：

```bash
npm run build
```

构建成功（无错误输出，退出码 0）后再进行下一步。如有错误须先修复再继续。

同时验证文档站构建：

```bash
npm run docs:build
```

文档站构建成功（`build complete`）后方可继续。如有错误须先修复。

同时验证 Demo 构建：

```bash
npm run build:demo
```

Demo 构建成功后方可继续。如有错误须先修复（Demo 构建使用 MSW Mock 模式，可能因 `.env.demo` 变量差异暴露额外问题）。

---

## Step 6：更新 `docs/changelog/index.md`

在文件顶部（第一个 `---` 分隔符之后，上一版本记录之前）**追加**当前版本的变更记录：

```markdown
## vX.Y.Z - YYYY-MM-DD

### Added

#### 功能分类
- 具体变更描述

### Changed

- 变更内容

### Fixed

- 修复内容
```

> 仅记录本次版本的实际变更，不伪造内容。根据 git log 整理，与用户确认关键变更点后再写入。

---

## Step 7：提交并推送 tag

```bash
# 将变更提交到 master
git add .
git commit -m "chore: release vX.Y.Z"
git push origin master

# 打 tag 并推送（触发 release.yml 自动构建）
git tag vX.Y.Z
git push origin vX.Y.Z
```

---

## Step 8：等待 GitHub Actions 完成

- `release.yml` 触发后会自动：构建产物 → 打包 zip → 提取 Changelog → 发布 GitHub Release
- 发布产物包含：`zenith-admin-server-vX.Y.Z.zip`（后端）和 `zenith-admin-web-vX.Y.Z.zip`（前端静态文件）

---

## 注意事项

- 版本含 `-beta`、`-rc`、`-alpha` 时，GitHub Release 自动标记为 Pre-release
- Release Notes 自动从 `docs/changelog/index.md` 中提取对应版本段落

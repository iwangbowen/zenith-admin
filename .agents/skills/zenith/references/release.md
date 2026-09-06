# 发布新版本流程

## 触发时机

用户说「发布 vX.Y.Z」「准备 X.Y.Z 版本」「release X.Y.Z」时，按此流程执行。

---

## Step 1：确认版本号

- 格式必须为 `x.y.z`（语义化版本），向用户确认版本号
- 运行 `git log <上一版本tag>..HEAD --oneline` 查看本次变更提交，用于撰写 Changelog

---

## Step 2：更新 package.json 版本号

同步更新**根 `package.json` 及 `packages/` 下所有包**的 `"version"` 字段：

- 根 `package.json`
- `packages/server/package.json`
- `packages/web/package.json`
- `packages/shared/package.json`
- `packages/analytics-sdk/package.json`
- `packages/electron/package.json`

> 若 `packages/` 下新增了包，一并同步，并将其补充到上述列表中。

---

## Step 3：同步 package-lock.json

版本号写入后，在项目根目录执行以下命令，使 `package-lock.json` 与 `package.json` 保持一致：

```bash
npm install --package-lock-only
```

> `--package-lock-only` 仅更新 lock 文件，不安装/变更 node_modules，速度快且安全。

---

## Step 4：更新 `docs/changelog/index.md`

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

> 仅记录本次版本的实际变更，不伪造内容。根据 Step 1 的 git log 整理，与用户确认关键变更点后再写入。
> changelog 先于验证写入，Step 5 的 docs 路构建的就是最终内容，**无需**在验证后再单独重跑 `docs:build`。

---

## Step 5：验证（默认增量快验，CI 全量把关）

CI（`ci.yml`）在每次 push master 时已全量跑 lint + test + build，Pages（`pages.yml`）构建文档站与 Demo。
发布验证据此分两级：**本地只快验受影响的包，全量交给发布提交推送后的 CI**——Step 6 中 tag 只在
CI 绿灯后才打；CI 红了就修复再推，tag 未推送就不会产生 Release，master 上的发布提交本身是惰性的。

### 5a. 确定受影响的包

```bash
git diff --name-only <上一版本tag>..HEAD
```

按依赖图归类（shared 被 server / analytics-sdk / web 依赖，analytics-sdk 被 web 依赖）：

| 变更路径 | 需本地验证的包 |
| --- | --- |
| `packages/shared/**` | 全部（等价全量，直接走 5c） |
| `packages/analytics-sdk/**` | analytics-sdk + web |
| `packages/server/**` | server |
| `packages/web/**` | web |
| `packages/electron/**` | 无独立测试，跟随 web（仅打包 web 产物） |
| `docs/**` | `npm run docs:build`（Step 4 的 changelog 属于此类，docs 路必跑） |
| 其余（`.github/`、`.agents/`、根配置） | 无需本地验证 |

### 5b. 本地快验（仅受影响包）

对受影响的包并行跑 lint + test，外加 docs 一路（Step 4 已改 changelog，docs 路必跑）；
**不跑本地 build**——全量 build 由推送后的 CI 把关，Demo 由 Pages 构建：

```bash
# 例：仅 web 受影响时
npx concurrently --group --timings -n lint,test,docs \
  "npm run lint -w @zenith/web" \
  "npm run test -w @zenith/web" \
  "npm run docs:build"
```

通过标准：lint **0 error**（warning 不阻塞）、test 全部通过、docs 输出 `build complete`。
多包受影响时按包各加一对 lint / test 命令。

### 5c. 全量路径（回退用）

以下情况跳过 5a/5b 直接全量四路：shared 有变更、跨包大范围改动、CI 不可用，或对增量判定没有把握。
Lint、测试、构建、文档站四类验证**互相独立**（只读源码、产物互不干扰），统一并行执行（项目已内置 `concurrently`）：

```bash
npx concurrently --group --timings --kill-others-on-fail -n lint,test,build,docs \
  "npm run lint" \
  "npm test" \
  "npm run build && npm run build:demo" \
  "npm run docs:build"
```

四路全部 `exit code 0` 方可继续。并行墙钟取决于最长的一路（通常是 test 或 build）。
任一路失败会立即终止其余任务，修复后可只重跑失败的那条命令。

### 读懂 `--kill-others-on-fail` 的输出

任一路失败时 `concurrently` 会**主动杀掉**其余三路，被杀的那几路同样打印非 0 退出码。
必须看结尾 Timings 表的 `killed` 列区分，**不要**看到多路飘红就以为崩了多处：

| `killed` 列 | 含义 | 处置 |
| --- | --- | --- |
| `false` + 非 0 退出码 | 真失败，问题就在这一路 | 定位并修复 |
| `true` | 被连带终止、根本没跑完 | 无需处理，重跑即可 |

### 测试超时

vitest 的并发度、超时与隔离策略已在 `packages/server/vitest.config.ts` / `packages/web/vitest.config.ts`
配置并注释了理由，本步骤无需额外传参。出现超时（而非断言失败）时按
[troubleshooting.md → 性能](./troubleshooting.md#性能) 判别与处置，不要为此把四路并行改成串行。

各路的通过标准：

- **lint**：`npm run lint` 依次跑 shared / server / analytics-sdk / web 四包 eslint，**0 error**（warning 不阻塞）
- **test**：`npm test` 依次跑 server 与 web 全部 vitest，全部通过
- **build**：`npm run build`（shared → analytics-sdk → server → web，依赖链**必须**串行）成功后接 `npm run build:demo`。
  ⚠️ `build` 与 `build:demo` 都写 `packages/web/dist` 与 tsbuildinfo，**两者之间禁止并行**，只能如上串联在同一路里
- **docs**：`npm run docs:build` 输出 `build complete`

---

## Step 6：提交推送，等 CI 绿灯后打 tag

```bash
# 1. 提交发布变更并推送 master（自动触发 CI 全量验证与 Pages 构建）
git add .
git commit -m "chore: release vX.Y.Z"
git push origin master

# 2. 等待 CI 通过（全量 lint + test + build，走 5b 增量快验时这一步是全量把关）
gh run list --workflow=ci.yml --branch master --limit 1   # 取最新 run id
gh run watch <run-id> --exit-status

# 3. CI 绿后打 tag 并推送（触发 release.yml 自动构建）
git tag vX.Y.Z
git push origin vX.Y.Z
```

> CI 失败时：修复后追加提交再推 master，全绿后再打 tag。tag 未推送就不会产生 Release，
> 无需回滚发布提交。走 5c 全量路径且 CI 拥堵时，可在本地全量已绿的前提下直接打 tag。

---

## Step 7：等待 GitHub Actions 完成

- `release.yml` 触发后会自动：构建产物 → 打包 zip → 提取 Changelog → 发布 GitHub Release
- 发布产物包含：`zenith-admin-server-vX.Y.Z.zip`（后端）和 `zenith-admin-web-vX.Y.Z.zip`（前端静态文件）

---

## 注意事项

- 版本含 `-beta`、`-rc`、`-alpha` 时，GitHub Release 自动标记为 Pre-release
- Release Notes 自动从 `docs/changelog/index.md` 中提取对应版本段落

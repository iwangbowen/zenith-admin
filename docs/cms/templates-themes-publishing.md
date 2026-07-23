# 模板、签名主题包与发布中心

CMS Stage 3 将模板扩展从“上传 React/TSX 代码”改为**仓库内可信 React 引擎解释声明式 DSL**。主题包永远不能携带或执行 JavaScript。

## 声明式模板 DSL

当前 DSL 版本为 `2`，文档结构为 `{ version: 2, root: node }`。Stage 4 将主题引擎兼容版本提升为 `2`；旧 `version: 1` 文档以及旧 `survey/poll` 模板类型在导入校验阶段直接拒绝，不会延迟到运行时 500。节点仅允许：

- `element`：固定 HTML 标签与逐标签属性白名单；禁止 `script`、`style`、`iframe`、事件属性和 `dangerouslySetInnerHTML`
- `text` / `binding`：React 文本转义
- `if` / `each`：固定绑定和集合白名单，不支持表达式
- `rich_text`：只允许正文、单页正文和搭建页 HTML，统一经过 Stage 1 `sanitizeCmsHtml`
- `component`：`seo_head`、`site_header`、`site_footer`、`breadcrumbs`、`content_list`、`content_detail`、`pagination`、`fragment`、`page_blocks`

绑定只覆盖站点、栏目、内容、SEO、导航、分页、碎片、友链、标签等 CMS 渲染上下文。不存在 `eval`、`Function`、任意表达式、模块名或组件导入。

`{ "asset": "..." }` 只在签名主题包中可用；手工模板没有包资源上下文，校验会给出明确错误，避免保存后才在正式渲染中失败。

硬限制：最大 32 层、500 节点、单节点 100 子节点/16 属性、单字符串 4096 字符、文档 256 KiB。保存、预览、激活和主题包导入都会重新校验。校验或渲染失败会明确失败，不会把错误模板当成功结果。

在递归 Zod schema 之前先执行迭代式 raw JSON preflight，限制原始深度、值/键/数组数量、字符串与序列化字节；数千层恶意对象会稳定返回 400，不会触发 `RangeError`。

模板版本只追加。回滚会复制目标快照为一个新版本并激活，不修改历史记录。校验和是递归按对象 key 排序、数组保持顺序的 UTF-8 canonical JSON 的 SHA-256。

### 与内置主题共存

- `default` / `docs` 仍是仓库内可信 TSX，继续作为内置主题。
- 内置主题显式选择模板时，站点级 DSL → 主题级 DSL → 内置变体/默认模板。
- 已激活签名主题包负责 `index/list/detail/page/search/tag/not_found`；缺失或错误会失败。
- 主题包的 `custom_page` / `interaction` 为可选能力，缺失时明确回退仓库内置可信实现；survey/poll 均使用统一 interaction 上下文与区块。
- 主题包模板没有可手工修改的全局激活状态；列表与选择器按站点当前 active deployment 的 manifest/包版本只读派生。
- 站点、栏目、内容原有模板引用继续健康检查；激活前可查看失效引用和预计重建范围。

## 签名主题包

包根目录只允许：

```text
manifest.json
templates/*.json
assets/*            # css/png/jpeg/gif/webp/woff/woff2
```

`manifest.json` 包含 `schemaVersion/code/name/version/engine/templates/assets/checksums/signingKeyId/signature`。签名内容为移除 `signature` 后的 canonical manifest；文件内容由 manifest 中 SHA-256 覆盖。

DSL 中 `{ "asset": "styles/site.css" }` 相对包内 `assets/` 解析，且必须在 manifest 的 `assets` 中声明；不允许模板引用未打包或远程样式资源。

导入安全边界：

- Ed25519 验签；没有可信公钥时 fail closed
- 拒绝 JS/TS/TSX/MJS/CJS、WASM、Node addon、脚本与可执行二进制
- 拒绝绝对路径、盘符、反斜杠、`.`/`..`、重复路径、未声明文件和 symlink
- 归档 ≤10 MiB、文件 ≤100、单文件 ≤3 MiB、解压总量 ≤20 MiB、解压比 ≤30
- CSS 由 `css-tree` 解析（包括 CSS escape 解码），对 `Raw` 节点 fail closed；禁止 `@import`、自定义属性、`var()`、外部/协议相对/data/绝对/越界 URL、`expression()` 与本地字体引用；资源只能指向 manifest 声明的包内相对 asset；图片/字体校验 magic bytes
- 文件先写受控 staging，`path.resolve` 双层 containment 后原子移动；DB 失败删除物理目录

配置：

```dotenv
CMS_THEME_STORAGE_ROOT=
CMS_THEME_TRUSTED_PUBLIC_KEYS={"production-2026":"<PEM 或 base64 SPKI DER>"}
CMS_THEME_SIGNING_KEY_ID=production-2026
CMS_THEME_SIGNING_PRIVATE_KEY=<PEM（\n 转义）或 base64 PKCS8 DER>
CMS_THEME_ENGINE_VERSION=2
```

可信公钥只来自安全配置。导出私钥只从环境/secret 注入，API 和数据库均不返回、不保存。没有私钥时签名导出返回明确不可用；导入不依赖私钥。

主题包版本并存；`cms_theme_deployments` 的部分唯一索引保证每个站点全局只有一个 active deployment。包、站点和 deployment 使用一致行锁顺序并在事务内重查。内置主题也走同一激活入口，会停用旧 package deployment。

匿名 asset URL 包含站点作用域：`/api/public/cms/theme-assets/{siteId}/{code}/{version}/assets/...`。服务端只有在该站点当前 active deployment、包 code/version、站点 theme 与可信校验状态全部精确匹配时才返回；仅 validated 但未部署的包不可匿名读取。

未激活包的后台预览使用绑定 `siteId + packageId` 的 5 分钟 HMAC capability asset URL，并设置 `private, no-store`；它只在通过站点 ACL 的预览响应中签发，不放宽正式匿名 asset 规则。

主题/模板生命周期变更、revision 递增和 pending 重建任务作为 outbox 在同一数据库事务持久化；提交后入队失败由任务中心 pending 恢复扫描补投。每个 revision 使用永久唯一事件键，因此同一事件双击只产生一个任务，而激活→停用→重激活会保留三个不同任务。

站点还维护 `templateRefsRevision`。站点/栏目/内容/页面模板引用写入、主题/模板生命周期及发布 worker 使用同一站点 advisory lock；生命周期 task 固化期望的 theme/reference/template revision 与 deployment id。worker 持锁贯穿生成，并在开始及每次文件 rename/delete 前复核 fence，过期任务直接标记 cancelled，不能覆盖新主题结果。

## CMS 发布中心

`/cms/publishing` 是 `async_tasks + async_task_items + cms_publish_artifacts` 的受权投影，不存在第二套发布队列或发布任务状态表。

统一任务类型 `cms-publish-build` 支持：

- 单内容、批量内容
- 栏目
- 整站
- 搭建页
- 主题/模板影响重建

普通人工重建只复用相同创建者、相同 payload 指纹的 pending/running 任务，terminal 任务不会吞掉后续合法重建。生命周期事件按 revision 永久幂等。任务使用稳定唯一目标顺序与 `phase + lastId/lastKey` checkpoint，并支持逐路径进度、协作取消、自动重试、断点恢复和重新开始。`cms_publish_artifacts` 只记录真实产物事实：站点/通道/内容/主题/模板、路径、URL、SHA-256、大小、状态、错误和生成时间；重试按 `task + path` 幂等覆盖，不存在的待删除文件不会写虚假 deleted 记录。

已发布内容的更新、发布、下线、回收与彻底删除会在业务事务中冻结旧 slug/栏目/正文分页/已有产物路径和新构建目标，并原子插入 pending task。purge 后 worker 仍依据快照删除旧文件，不重新依赖已删除内容行；连续更新会合并尚未执行任务的路径谱系。

生产 `db:migrate` 在 DDL 完成后执行有版本记录和 advisory lock 的应用数据迁移，幂等 upsert CMS 菜单、1745 权限和必要角色绑定；无需额外运行 full seed。

普通用户只能看到自己提交、且当前仍有站点 ACL 的任务和产物。平台超管或拥有系统任务管理权限的用户可看全局。栏目/批量内容提交仍执行 Stage 1 站点与栏目 ACL，批量对象缺失或越权时整体 fail closed。

### 发布入口

- 人工整站、栏目、批量内容、主题/模板影响：任务中心执行。
- 内容状态事务先同步提交；事务成功后，直接发布、工作流、定时发布和采集自动发布统一提交增量任务，不改变内容事务语义。
- 搭建页保存/停用/删除在写事务后提交增量任务。
- 内置主题代码 watch 使用相同 `cms-publish-build`，并保留指纹级幂等。
- 小型动态 SSR 请求和静态 miss 回写仍同步/后台回写，不制造发布任务。

产物与逐路径日志分别注册为导出中心实体 `cms.publish-artifacts`、`cms.publish-logs`，支持站点和时间范围筛选。

## 权限

- 模板：`cms:template:view|manage|activate`
- 主题：`cms:theme:view|import|activate|export`
- 发布：`cms:publish:view|build|manage`

所有写接口同时执行菜单权限、站点/栏目 ACL 和操作审计。

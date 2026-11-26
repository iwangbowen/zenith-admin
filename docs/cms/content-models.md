# 内容模型与扩展字段

内容模型为站点、栏目与内容提供**自定义结构化字段**（EAV via JSONB）：模型定义字段元数据，值存入宿主对象的 `extend` 列。政府站的「文号/发布机关」、游戏站的「评分/平台/发售日期」、产品站的「价格/规格」都由同一套机制承载；`object` / `array` / `blocks` 三类复合字段让「一篇文章多个小编组件」「动态区块编排」也不必新建表。

管理入口：`/cms/models`（权限 `cms:model:*`）。表：`cms_models` / `cms_model_fields` / `cms_model_versions` / `cms_model_unique_values`。普通操作员的列表、详情、字段、引用、版本和更新请求都带 `siteId` scope；平台管理员可以省略 scope 查看平台共享模型的全局引用。

## 字段类型

共 17 种（`CMS_FIELD_TYPES`），编辑表单按类型渲染对应控件：

| 类型 | 控件 | 值形态 |
|------|------|--------|
| `text` / `textarea` | 单行 / 多行文本 | string |
| `richtext` | 富文本编辑器 | HTML string（写入前经 `sanitizeCmsHtml`） |
| `number` | 数字输入 | number |
| `date` / `datetime` | 日期 / 日期时间选择 | `YYYY-MM-DD` / `YYYY-MM-DD HH:mm:ss` |
| `image` / `file` | 媒体库选取 / 上传 | 素材句柄（`cms-res://{id}`） |
| `select` / `radio` | 下拉 / 单选 | 选项 value |
| `checkbox` | 多选 | value[] |
| `switch` | 开关 | boolean |
| `reference` / `references` | 内容选择器（单选 / 多选） | 站内内容 id / id[] |
| `object` | 字段组（固定子字段） | 对象 |
| `array` | 重复组件（同构子字段可增删排序） | 对象数组 |
| `blocks` | 动态区块（按区块类型解释子字段） | 带 `blockType` 的对象数组 |

复合字段的子字段类型收敛为 `CMS_COMPONENT_FIELD_TYPES`（`text` / `textarea` / `richtext` / `number` / `date` / `datetime` / `switch`）——子字段内不再嵌套媒体与选项类字段。子字段同样可勾选「发布必填」，`object` 递归校验，`array` / `blocks` 逐项校验。

## 字段配置项

模型编辑器中每个字段可配置：

| 配置 | 作用 |
|------|------|
| 标识 `name` / 名称 `label` | `name` 为 `extend` 的 JSON key（`^[a-z][a-z0-9_]*$`），`label` 为表单与前台展示名 |
| 必填 `required` | **发布必填**——见下方「校验分层」 |
| 检索 `searchable` | 值纳入全文检索（权重 C），并开放给 Headless API 的 `extend.{字段}` 过滤 |
| 列表显示 `showInList` | 字段值注入前台**列表项**（卡片角标场景，如评分/平台），后台内容列表同样展示 |
| 详情展示 `showInDetail` | 字段值注入前台**详情页**，由主题渲染（如公文「文件信息」表头） |
| 详情分组 `detailGroup` / 排序 `detailSort` | 详情展示的分组标题与组内顺序；`detailSort` 按模型编辑器行序自动落库 |
| 默认值 `defaultValue` | 新建内容时自动填充（前端初始化 + 服务端创建兜底回填，双保险） |
| 提示文案 `placeholder` | 编辑表单占位提示 |
| 选项来源 `optionSource` / 字典 `dictCode` / 选项 `options` | 见下方「选项来源」 |

「字段规则」（`configuration`）按类型展开，逐项都是写入校验的一部分：

| 规则 | 适用 | 语义 |
|------|------|------|
| `min` / `max` | `number` | 数值闭区间 |
| `minLength` / `maxLength` | 文本类 | 字符长度区间；组件数组用它表示条数上限（缺省 1000） |
| `unique` | 标量字段 | **模型内值唯一**，由 `cms_model_unique_values` 落约束明细 |
| `referenceModelIds` | `reference` / `references` | 允许引用的内容模型白名单 |
| `requiredWhen`（`{ field, equals }`） | 全部 | 条件必填：同模型某字段等于指定值时该字段必填 |
| `fields` | `object` / `array` | 子字段定义 |
| `blockTypes`（`{ code, label, fields }`） | `blocks` | 允许的区块类型及其子字段 |

字段标识 `name` 在同一模型内必须唯一；编辑字段规则只产出**模型工作稿**，不会改变已发出内容的解释方式（见「模型版本」）。

### 选项来源（select / radio / checkbox）

| 来源 | 配置方式 | 适用 |
|------|---------|------|
| **手工维护**（默认） | 模型编辑器内直接填写，**每行一个选项**，格式 `值\|显示名`（显示名可省略，如 `pc\|PC` 或 `PC`） | 模型专属选项 |
| **引用系统字典** | 只填字典编码，选项在读取模型时实时解析自 `dict_items`（仅启用项，按 sort 排序） | 多模型共用、需统一治理的选项 |

字典维护一处、所有引用它的模型字段自动同步。解析结果经 `resolvedOptions` 统一返回，内容编辑表单与前台翻译均按它渲染；字典编码不存在时解析为空数组，不影响其他字段。引用字典却未填编码在保存时即被拦截。

## 校验分层：草稿宽松、发布严格

扩展字段的服务端校验（`validateCmsStructuredFields`）按目标状态分层，编辑器可以随时存草稿、不被半成品数据卡住：

| 时机 | 校验强度 |
|------|---------|
| 保存草稿 / 更新草稿 | **宽松**：仅校验类型合法性与选项 value 合法性，必填不拦截 |
| 提交审核 / 发布 | **严格**：额外校验 `required`、`requiredWhen` 与复合结构必填 |

无论哪一层，以下都在写入时强制：字段必须在该模型（或其固定版本）中定义、数值与长度区间、`reference` 必须指向存在的内容、`referenceModelIds` 白名单、`blocks` 区块类型必须在 `blockTypes` 中、`select`/`radio`/`checkbox` 的提交值必须命中已解析选项、`unique` 字段不重复。

前端编辑表单不挂 required 规则，改在字段 label 上标注「（发布必填）」提示；创建时 `defaultValue` 自动回填。校验统一挂在创建、更新、提审、发布全部写入口，Headless API 写入同样生效。

## 模型版本

模型字段是可演进的配置，而内容必须能被**确定性解释**，因此两者分开：

- 编辑模型（含字段规则）保存为**模型工作稿**（`cms_models.publishedVersionId` + `hasUnpublishedChanges`），列表与编辑器提示「存在未发布修改」
- `POST /api/cms/models/{id}/publish` 校验工作稿后生成**不可变模型版本**（`cms_model_versions`，带 `version`、`fields` 快照与 `contentHash`）
- 内容在创建 / 更新时把当时的模型版本固化进自己的修订快照（`revision.snapshot.modelVersionId`），渲染、列表翻译与校验一律按**该版本**取字段定义；模型后续改版只影响新稿，已审核修订保留原模型版本
- `GET /api/cms/models/{id}/versions` 查看历史版本

已有工作稿与修订继续按其固化模型版本解释和校验扩展字段。模型发布新版本后，不会静默重解释已审核或已发布修订；内容要采用目标模型版本时，应预览字段映射和移除影响，再生成工作稿。

## 三级绑定

模型通过宿主对象各自的 `model_id` + `extend` 列绑定到三级：

| 绑定级 | 绑定位置 | 值存放 | 用途 |
|---|---|---|---|
| 站点 | `cms_sites.model_id` | `cms_sites.extend` | 站点级运营元数据（备案号、客服电话等），主题经 `site.extend` 读取 |
| 栏目 | `cms_channels.model_id` | 新建内容工作稿的 `extend` | 创建内容未指定模型时提供默认模型 |
| 内容 | 工作稿快照及发布后的 `cms_contents.model_id` | 工作稿快照及发布后的 `cms_contents.extend` | 内容独立绑定模型，编辑与展示按其固定模型版本解释；移动栏目保留模型 |

内容模型切换走[内容管线 → 编辑协作](./content-pipeline#编辑协作-批注、质量与转换)中的「切换内容模型」：先预览字段映射和移除影响，确认后写入新工作稿。图文 / 图集 / 音视频 / 外链属于内容形态，创建后不可修改。

## 站群归属治理

模型带**归属**（`cms_models.owner_site_id`，创建后不可变更）：

| 归属 | 语义 |
|------|------|
| **平台共享**（`owner_site_id = null`） | 全部站点可见、可绑定；内置模型（文章/产品）属此类；仅平台管理员可创建、更新或删除 |
| **站点专属** | 仅归属站点可见、可绑定 |

- **可见性过滤**：模型列表与绑定下拉按「平台共享 + 当前站点专属」过滤，A 站的专属模型不会出现在 B 站的任何选择器里；普通请求缺少 `siteId` 会返回 400
- **跨站绑定拦截**：服务端在站点/栏目/内容绑定模型时校验归属（`assertCmsModelUsableBySite`），越权绑定直接 400
- **引用清单**：`GET /api/cms/models/{id}/refs?siteId=` 返回当前 scope 内模型被哪些站点/栏目/内容绑定；平台管理员省略 `siteId` 时返回全局引用，删除前应确认 `channels`、`contentCount` 和 `siteExtendCount` 均为 0
- 后台模型列表展示「归属」列（平台共享 / 站点名徽章），创建时以单选指定，站点过滤器联动

## 前台渲染消费

模型字段值由渲染管线**翻译为展示值**后注入主题上下文（`CmsModelFieldValue[]`）：字典/选项 value 反查 label、`checkbox` 多值以「、」连接、日期格式化、`switch` 转 是/否、`richtext` 输出纯文本摘要（完整渲染由主题自行处理 `rawValue`）。`reference` / `references` / `object` / `array` / `blocks` 属于结构化取值，由主题读取 `rawValue` 自行渲染。

| 注入位置 | 来源字段 | 典型主题用法 |
|---|---|---|
| `ctx.content.modelFields`（详情页） | `showInDetail` 字段，按 `detailGroup` 分组、`detailSort` 排序 | gov-portal 用共享组件 `ModelFieldTable` 渲染公文「文件信息」双栏键值表；magazine 把 `ratingField` 拆出渲染大评分徽章、其余字段行内标签 |
| `item.modelFields`（列表项） | `showInList` 字段 | magazine / default 卡片角标（「9.5」「PC、PS5」chips） |

列表场景按 modelId（或固定 modelVersionId）**批量预载**字段定义后同步翻译（一页列表通常仅涉及 1-2 个模型），首页区块、栏目列表、标签页与 Theme API 取数结果全部生效。主题侧消费方式见[主题与模板开发](./themes#消费模型字段)。

## 质量检查

编辑页的**质量检查**（`GET /api/cms/editorial/{id}/quality`）与模型切换预览共用同一份问题结构（`cmsQualityIssueSchema`：`rule` / `severity` / `fieldPath` / `message`）。界面将字段路径解析为中文名称，质量清单提供返回编辑字段的定位入口；它不阻断保存，发布时仍由服务端严格校验兜底。

| 规则 | 级别 | 检查内容 |
|------|------|----------|
| `title` | error | 标题为空或仍是「未命名内容」 |
| `schedule` | error | `expireAt` 不晚于 `scheduledAt` |
| `dependencies` | error | 依赖冻结（strict）失败：扩展字段与模型版本规则、素材引用、部件与栏目依赖等 |
| `summary` | warning | 未填写摘要 |
| `cover` | warning | 未选择封面 |
| `seoTitle` | warning | 未设置独立 SEO 标题 |
| `accessibility` | warning | 正文图片缺少替代文本（定位到文档节点） |

字段级问题来自 `validateCmsStructuredFields`：字段未在该模型 / 模型版本中定义、必填与条件必填缺失、数值与长度越界、组件条数超限、选项失效、`blocks` 区块类型未知、`reference` 指向不存在或不在白名单内的内容。

## 接口

- `GET/POST /api/cms/models`、`GET/PUT/DELETE /api/cms/models/{id}`（列表/详情/更新/删除的普通请求带 `?siteId=`；列表返回平台共享 + 当前站点专属模型）
- `GET /api/cms/models/all?siteId=` 栏目与内容模型下拉源
- `GET /api/cms/models/{id}/refs?siteId=` 引用清单
- `GET /api/cms/models/{id}/versions?siteId=` 不可变模型版本；`POST /api/cms/models/{id}/publish` 发布模型工作稿
- 模型字段发布新版本后，服务端按模型归属为受影响站点提交重建任务（平台共享模型覆盖平台站点范围），静态页异步按新定义更新

# 素材与图文草稿

素材管理对接微信**永久素材**接口，图文草稿对接**草稿箱**，二者是群发、模板消息、菜单图文的内容来源。

---

## 素材管理

永久素材保存在 `mp_materials`：

| 字段 | 说明 |
| --- | --- |
| `type` | `image` 图片 / `voice` 语音 / `video` 视频 / `thumb` 缩略图 |
| `name` | 本地名称 |
| `wechat_media_id` | 微信永久素材 media_id |
| `url` | 素材访问 URL（图片有效） |

### 真实二进制上传

`POST /api/mp/materials/upload` 接收 `multipart/form-data` 文件，通过 `lib/wechat/material.ts` 的 `uploadWechatMaterial` 转调微信 `material/add_material`，成功后落地本地素材。

> `hono/csrf` 对 form 类型请求校验 `Origin`：真实浏览器上传会携带 `Origin` 头，开发模式（`ALLOWED_ORIGINS` 为空）放行。

`POST /api/mp/materials/sync` 从微信 `batchget_material` 分页拉取永久素材并 upsert 本地。

---

## 图文草稿

图文草稿保存在 `mp_drafts`，对接微信草稿箱：

| 字段 | 说明 |
| --- | --- |
| `title` | 草稿标题（首篇文章标题） |
| `articles` | 图文文章数组（标题 / 作者 / 封面 / 正文 / 摘要 / 原文链接等） |
| `wechat_media_id` | 推送到微信后返回的草稿 media_id |
| `status` | `draft` / `published` |

工作流：编辑草稿（本地）→ 推送到微信草稿箱（`draft/add`，回填 `wechat_media_id`）。推送后的草稿 `wechat_media_id` 可作为群发（`mpnews`）或菜单图文的素材来源。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/materials` | `mp:material:list` | 素材列表 |
| `POST` | `/api/mp/materials/upload` | `mp:material:create` | 上传素材（multipart） |
| `PUT` | `/api/mp/materials/{id}` | `mp:material:update` | 重命名素材 |
| `DELETE` | `/api/mp/materials/{id}` | `mp:material:delete` | 删除素材 |
| `POST` | `/api/mp/materials/sync` | `mp:material:sync` | 从微信同步素材 |
| `GET` | `/api/mp/drafts` | `mp:draft:list` | 图文草稿列表 |
| `POST` | `/api/mp/drafts` | `mp:draft:create` | 新增图文草稿 |
| `PUT` | `/api/mp/drafts/{id}` | `mp:draft:update` | 编辑图文草稿 |
| `POST` | `/api/mp/drafts/{id}/push` | `mp:draft:push` | 推送到微信草稿箱 |
| `DELETE` | `/api/mp/drafts/{id}` | `mp:draft:delete` | 删除图文草稿 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 素材管理 | `/mp/materials` | 素材列表、上传、重命名、删除、同步 |
| 图文草稿 | `/mp/drafts` | 草稿列表、多图文编辑、推送到微信、删除 |

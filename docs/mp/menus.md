# 菜单管理

公众号菜单分两类：每个账号唯一的**默认自定义菜单**，以及按规则向不同人群下发的**个性化菜单**。两者按钮结构一致（最多 3 个一级菜单，每个最多 5 个二级）。

---

## 自定义菜单

默认菜单保存在 `mp_menus`（每账号一条，`account_id` 唯一）：

| 字段 | 说明 |
| --- | --- |
| `buttons` | 按钮树（jsonb） |
| `status` | `draft` 草稿 / `published` 已发布 |
| `published_at` | 发布时间 |

工作流：保存草稿 → 发布（调微信 `menu/create`）→ 可拉取微信当前菜单（`menu/get`）回填草稿 → 删除（`menu/delete`）。

### 按钮类型

按钮 `type` 支持点击与跳转两大类，并已扩展事件类型：

| 类型 | 说明 |
| --- | --- |
| `click` | 点击推事件（携带 `key`） |
| `view` | 跳转网页（`url`） |
| `miniprogram` | 跳转小程序（`appid` + `pagepath`） |
| `scancode_waitmsg` / `scancode_push` | 扫码 |
| `pic_sysphoto` / `pic_photo_or_album` / `pic_weixin` | 拍照 / 相册 / 发图 |
| `location_select` | 地理位置选择 |
| `media_id` / `view_limited` | 下发 / 跳转图文素材 |

> 父级菜单（含二级子菜单）本身无动作，`type` 留空。

---

## 个性化菜单

个性化菜单保存在 `mp_conditional_menus`，按**匹配规则**向不同人群下发不同菜单；未命中任何个性化菜单的用户看到默认自定义菜单。

| 字段 | 说明 |
| --- | --- |
| `name` | 本地名称（便于管理识别） |
| `buttons` | 按钮树（结构同默认菜单） |
| `match_rule` | 匹配规则（jsonb） |
| `menu_id` | 微信返回的 `menuid`（发布后写入） |
| `status` / `published_at` | 草稿 / 已发布 |

### 匹配规则

`match_rule` 至少设置一项（前端 camelCase，下发微信转 snake_case）：

| 规则 | 字段 | 说明 |
| --- | --- | --- |
| 标签 | `tagId` | 微信标签 id |
| 性别 | `sex` | `1` 男 / `2` 女 |
| 客户端 | `clientPlatformType` | `1` iOS / `2` Android / `3` PC |
| 地区 | `country` / `province` / `city` | 国家 / 省 / 市 |
| 语言 | `language` | 如 `zh_CN` |

### 发布与匹配测试

- **发布**：调微信 `menu/addconditional` 写入新 `menuid`；若已存在旧 `menuid` 先 `delconditional` 删除，避免菜单泄漏。
- **匹配测试**：`menu/trymatch` 输入 openid 或微信号，返回该用户实际命中的菜单按钮，便于验证规则配置。

---

## 接口一览

| 方法 | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/mp/menu` | `mp:menu:list` | 获取默认菜单 |
| `POST` | `/api/mp/menu` | `mp:menu:save` | 保存菜单草稿 |
| `POST` | `/api/mp/menu/publish` | `mp:menu:publish` | 发布菜单 |
| `POST` | `/api/mp/menu/pull` | `mp:menu:pull` | 拉取微信当前菜单 |
| `DELETE` | `/api/mp/menu` | `mp:menu:delete` | 删除菜单 |
| `GET` | `/api/mp/conditional-menus` | `mp:condmenu:list` | 个性化菜单列表 |
| `POST` | `/api/mp/conditional-menus` | `mp:condmenu:create` | 新增个性化菜单 |
| `PUT` | `/api/mp/conditional-menus/{id}` | `mp:condmenu:update` | 编辑个性化菜单 |
| `POST` | `/api/mp/conditional-menus/{id}/publish` | `mp:condmenu:publish` | 发布个性化菜单 |
| `DELETE` | `/api/mp/conditional-menus/{id}` | `mp:condmenu:delete` | 删除个性化菜单 |
| `POST` | `/api/mp/conditional-menus/trymatch` | `mp:condmenu:list` | 菜单匹配测试 |

---

## 前端页面

| 页面 | 路径 | 主要能力 |
| --- | --- | --- |
| 自定义菜单 | `/mp/menu` | 按钮编辑器、保存草稿、发布、拉取、删除 |
| 个性化菜单 | `/mp/conditional-menus` | 列表、两级按钮编辑器、匹配规则、发布 / 删除、匹配测试 |

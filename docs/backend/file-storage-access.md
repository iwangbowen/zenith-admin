# 文件存储访问策略与浏览器直传

本文说明文件存储配置的下载方式、Bucket 权限探测/设置、浏览器直传与秒传。适用于 `system/file-configs` 与文件列表上传。

## 1. 三个独立概念

| 概念 | 配置项 | 作用 |
| --- | --- | --- |
| 对象读写权限 | `objectAcl` | 上传时给对象设置 ACL：继承 Bucket / 私有 / 公共读 / 公共读写 |
| 下载方式 | `accessStrategy` | 下载地址如何生成：服务端代理 / 临时签名 / 公开直链（对象 ACL、Bucket 公共读、自定义域名） |
| 上传方式 | `uploadMode` | 服务端中转 / 浏览器直传 |

三者互不替代：

- 上传始终只有两条链路：服务端中转或浏览器直传。
- `accessStrategy` 只影响下载地址，不影响上传链路。
- `objectAcl` 只在服务端中转或直传完成时设置对象 ACL。

## 2. 下载方式

| accessStrategy | 公共性来源 | 前提 |
| --- | --- | --- |
| `proxy` | 无 | 所有 provider，服务端鉴权后转发 |
| `presigned` | 临时签名 | 云存储支持签名；local/SFTP 不支持 |
| `public-object` | 对象 ACL | 对象 ACL 为 `public-read` / `public-read-write`；Bucket 未开启阻止公共访问 |
| `public-bucket` | Bucket ACL | Bucket 为公共读，对象必须「继承 Bucket」；Bucket 未开启阻止公共访问 |
| `public-domain` | CDN / 自定义域名 | 配置 `publicBaseUrl`（Kodo 可用下载域名，SFTP 可用 Base URL） |

解析失败时按 `public → presigned → proxy` 降级。

## 3. Bucket 权限探测与设置

配置页「云端 Bucket 权限（实时）」支持探测和修改：

| Provider | ACL 探测/设置 | 阻止公共访问探测/设置 |
| --- | --- | --- |
| OSS | ✅ | ✅ |
| S3 | ✅（桶启用 ACL 时） | ✅（Bucket 级） |
| COS | ✅ | ❌ |
| OBS | ✅ | ❌ |
| BOS | ✅ | ❌ |
| Azure Blob | ✅（Container 访问级别） | ❌ |
| Kodo | ✅（私有/公开） | ❌ |
| local / SFTP | ❌ | ❌ |

写操作使用独立权限 `system:file:config:bucket-access`，并记审计。账号级 OSS 全局阻止公共访问只展示，不提供修改。

## 4. 浏览器直传

### 4.1 流程

```text
浏览器 → POST /api/files/direct-uploads
服务端 → 生成 objectKey + 预签名 PUT URL（短期）
浏览器 → PUT 文件到云存储（不经过服务端）
浏览器 → POST /api/files/direct-uploads/{uploadId}/complete
服务端 → HEAD 校验大小/类型/ETag → 写入 managed_files
```

失败或取消：`DELETE /api/files/direct-uploads/{uploadId}`，服务端删除对象并关闭会话。

### 4.2 Provider 能力

| Provider | 直传机制 | 状态 |
| --- | --- | --- |
| OSS | 预签名 PUT | 已实现并实测 |
| S3 | 预签名 PUT | 已实现 |
| COS | 预签名 PUT | 已实现 |
| OBS | 预签名 PUT | 已实现 |
| Azure Blob | SAS | 已实现 |
| BOS | 未接入 | 走服务端中转 |
| Kodo | 未接入（uploadToken） | 走服务端中转 |
| local / SFTP | 不支持 | 走服务端中转 |

### 4.3 前置条件

- Bucket 配置 CORS：允许后台站点 Origin 的 `PUT` / `POST` / `GET` / `HEAD`。
- 云账号 AccessKey 具备对应对象的 `PutObject` 权限；预签名 PUT 使用现有 AccessKey 在服务端签名，不下发长期密钥。
- 完成校验依赖 `HEAD` 权限。

### 4.4 秒传

文件 ≤ 32MB 时浏览器计算 SHA-256，先调用 `POST /api/files/quick-upload`：

- 命中同一默认存储、同一租户下仍存在的对象 → 直接复用文件记录，不再上传。
- 未命中或对象已被删除 → 正常直传。

大文件暂不计算哈希，避免一次性读入内存。

## 5. 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 上传报 `Put public object acl is not allowed` | Bucket 开启阻止公共访问 | 关闭 Bucket 级 BPA，或改用 Bucket 公共读 / CDN / 临时签名 |
| 浏览器直传 CORS 失败 | Bucket 未配置 CORS | 在云控制台添加站点 Origin 的 PUT 规则 |
| 直传 403 | 预签名 URL 过期或对象 Key 不匹配 | 重新申请上传会话；检查系统时间 |
| 完成校验大小不一致 | 上传中断或客户端改写文件 | 重新上传 |
| 公开直链 403 | Bucket ACL 非公共读 / BPA 开启 / 对象 ACL 非公共读 | 在配置页探测并修正 Bucket 权限，或切换下载方式 |

## 6. 环境变量与配置

- 直传有效期来自存储配置的 `presignedExpirySeconds`（默认 1800 秒）。
- 「上传方式」为 `browser-direct` 时，文件列表使用直传；其他入口仍可走服务端中转。
- 服务端中转保留给 local / SFTP、后端生成文件和不支持直传的 provider。

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

解析失败时按 `public → presigned → proxy` 降级。`visibility=restricted` 的文件不生成任何公开直链，仍只经归属模块鉴权接口读取。

## 3. Bucket 权限探测与设置

新建或编辑云存储配置时，「云端 Bucket 权限（实时）」支持先探测，再修改。探测结果包含 Bucket ACL、Bucket 级阻止公共访问、Bucket Policy 公共状态，以及 provider 提供的综合公共状态；「实际公共读」是这些状态的综合结果，并落库到 `bucket_acl`、`bucket_block_public_access`、`bucket_policy_public`、`bucket_public_status`。

| Provider | ACL 探测/设置 | 阻止公共访问探测/设置 |
| --- | --- | --- |
| OSS | ✅ | ✅ |
| S3 | ✅（桶启用 ACL 时） | ✅（Bucket 级） |
| COS | ✅ | ❌ |
| OBS | ✅ | ✅（Bucket 级 BPA + `GetBucketPublicStatus`） |
| BOS | ✅ | ❌ |
| Azure Blob | ✅（Container 访问级别） | ✅（仅探测账号级 `allowBlobPublicAccess`，需管理面凭据） |
| Kodo | ✅（私有/公开） | ❌ |
| local / SFTP | ❌ | ❌ |

写操作使用独立权限 `system:file:config:bucket-access`，并记审计。当前面板探测和修改的是 Bucket / Container 级状态；OSS 会额外探测账号级阻止公共访问并展示（不提供修改），S3 在配置了 12 位 `s3AccountId` 时通过 S3 Control 探测账号级 BPA（不提供修改），Azure 在配置管理面 Tenant / Client / Secret / Subscription / Resource Group 后通过 ARM 探测账号级 `allowBlobPublicAccess`（不提供修改）。OSS / S3 会读取 Bucket Policy 的公共访问状态，OBS 会读取 BPA 与 `GetBucketPublicStatus`，COS / BOS 读取 Bucket Policy，Kodo 读取访问模式与防盗链；其他 provider 的 Bucket Policy / 防盗链仍可能影响实际匿名访问，面板显示的是 ACL/BPA/Policy 综合结果，不覆盖 CDN 自身鉴权。

创建配置时，探测和设置直接使用尚未保存的表单凭据。云端权限修改会立即生效，不依赖点击「保存」创建配置行；修改表单中的 Provider 或凭据后会要求重新探测。

## 4. 浏览器直传

### 4.1 流程

```text
浏览器 → POST /api/files/direct-uploads
服务端 → 初始化 provider multipart 会话并返回分片大小
浏览器 → 为每片申请短时 PUT URL / 凭证并直传云存储
浏览器 → 确认分片 ETag；刷新后查询状态并只重传缺失分片
浏览器 → POST /api/files/direct-uploads/{uploadId}/complete（必须携带整文件 SHA-256）
服务端 → 合并、HEAD 校验真实对象大小、校验类型与 SHA-256、写入 managed_files
```

上传状态复用 `upload_sessions` / `upload_chunks`，localStorage 保存会话 ID 与流式计算的整文件 SHA-256。网络中断或刷新后重新选择同一内容的文件会续传；仅元数据相同但内容不同的文件会中止旧会话并重新上传。显式取消调用 `DELETE /api/files/direct-uploads/{uploadId}`，服务端中止 multipart 并关闭会话。过期会话由既有上传会话清理任务处理。

### 4.2 Provider 能力

| Provider | 直传机制 | 状态 |
| --- | --- | --- |
| OSS | multipart 分片预签名 PUT | 已实现 |
| S3 | UploadPart 预签名 PUT | 已实现 |
| COS | multipart 分片预签名 PUT | 已实现 |
| OBS | multipart 分片预签名 PUT | 已实现 |
| Azure Blob | SAS + staged block | 已实现 |
| BOS | multipart 分片签名 PUT | 已实现 |
| Kodo | 对象级短时 uploadToken + 分片 v2 | 已实现 |
| local / SFTP | 不支持 | 走服务端中转 |

### 4.3 前置条件

- Bucket 配置 CORS：允许后台站点 Origin 的 `PUT` / `POST` / `GET` / `HEAD` 与 `Content-Type`、`Authorization`、`x-ms-version` 等 provider 请求头；OSS、S3、COS、OBS、BOS 需暴露 `ETag`，Kodo 响应体包含分片标签，Azure 使用服务端确定的 block id。
- 云账号 AccessKey 具备初始化 multipart、上传分片、完成 multipart、中止 multipart 和 `HEAD` 权限；服务端按对象签发短时 URL 或 uploadToken，不下发长期密钥。
- Kodo multipart v2 单片为 4 MiB；其他 provider 使用运行时 `files.chunkSizeMb`（5–32 MiB）。

### 4.4 秒传

文件 ≤ 32MB 时浏览器计算 SHA-256，先调用 `POST /api/files/quick-upload`：

- 命中同一默认存储、同一租户下仍存在的对象 → 直接复用文件记录，不再上传。
- 未命中或对象已被删除 → 正常直传。

秒传只对 ≤ 32MB 文件做一次性哈希；更大的文件不参与秒传。浏览器直传仍会流式计算整文件 SHA-256 用于续传校验与完成校验，不会一次性读入内存。

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
- 每用户同时进行中的直传会话上限来自运行时设置 `files.directUploadMaxActiveSessions`（默认 20，0 表示不限制）。
- 服务端默认只对不超过 `files.directUploadHashVerifyMaxMb`（默认 256MB）的直传文件回读复核 SHA-256；更大的文件只校验大小/类型，浏览器仍在 Worker 中计算哈希用于续传本地校验。
- 「上传方式」为 `browser-direct` 时，文件列表、聊天附件、头像、媒体选择器和通用附件等走直传；直传失败会自动释放直传会话并回退服务端中转。导入预检使用 `restricted` 可见性，仍走服务端；网盘、工作流附件、CMS 素材、App 制品等带业务绑定的上传也走各自服务端通道，避免绕过业务权限与落库校验。
- 服务端中转保留给 local / SFTP、后端生成文件和不支持直传的 provider。

## 7. 指标

Prometheus 抓取端点会导出以下进程内计数：

- `zenith_file_direct_uploads_started_total` / `completed` / `failed` / `aborted`：直传会话生命周期。
- `zenith_file_direct_upload_bytes_total`：直传接受的总字节数。
- `zenith_file_quick_upload_hits_total` / `misses_total`：秒传命中率。
- 直传降级到服务端中转由浏览器侧触发，目前通过上传结果和前端错误日志排查；后续可补浏览器埋点。

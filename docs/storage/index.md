# 文件与存储

Zenith Admin 提供统一的文件管理、文件存储配置与业务附件能力。文件上传后由默认存储服务写入后端存储，元数据落库到 `managed_files`，业务模块通过 `business_files` 关联文件记录，前端统一使用文件预览组件完成预览、下载与附件展示。

---

## 能力总览

| 能力 | 当前实现 |
| --- | --- |
| 存储后端 | 核心适配层支持 `local / oss / s3 / cos / obs / kodo / bos / azure / sftp` 9 种 provider |
| 默认存储 | `file_storage_configs.is_default` 标记默认服务；上传时只使用启用状态的默认配置 |
| 上传安全 | 通过 Magic Bytes 检测真实 MIME 类型，结合系统配置白名单拦截不允许的文件 |
| 文件管理 | 上传、分页列表、详情、内容读取、预览、下载、删除、批量删除、批量 ZIP 下载 |
| 存储浏览 | 按存储配置与对象键前缀浏览目录，支持列表 / 网格视图 |
| 文件统计 | 总数、总大小、类型分布、provider 分布、近 12 个月趋势、上传人 Top、大小区间 |
| 业务附件 | `business_files` 将文件与业务实体关联，当前业务类型枚举为 `announcement` |
| 前端预览 | 图片、PDF、音视频、Excel/CSV、Word、Markdown、文本、JSON、SVG、代码、ZIP 等格式由统一组件处理 |

---

## 存储后端

核心实现位于 `packages/server/src/lib/file-storage.ts`。对象键由 `basePath + YYYY/MM/DD + 时间戳-随机串 + 原扩展名` 组成，例如 `uploads/2026/06/20/1780000000000-ab12cd34.png`。

### 流式 I/O

上传与下载全程采用流式传输，**不再把整个文件读入内存**，避免大文件导致的 OOM：

- 上传：所有 provider 直接消费请求体的可读流（`local` 用 `pipeline`，`oss/s3/cos` 用原生 stream API，`obs/kodo/bos/azure/sftp` 分别用 `putObject(Body:Readable)` / `putStream` / `putObject(stream)` / `uploadStream` / `put(stream)`）。
- 下载：`local/oss/s3/azure/kodo` 返回原生流；`cos` 用 `getObjectStream`，`obs` 用 `getObject({ SaveAsStream:true })`，`bos` 用预签名 URL + `fetch`，`sftp` 用独立连接 `get(path, PassThrough)` 并在流读取完成后再关闭连接。
- 批量 ZIP 下载逐个文件流式写入压缩包，等待上一个条目处理完再打开下一个远端连接，同一时刻仅持有一个源流。

通用字段：

| 字段 | 说明 |
| --- | --- |
| `name` | 存储配置名称 |
| `provider` | 存储类型：`local / oss / s3 / cos / obs / kodo / bos / azure / sftp` |
| `status` | `enabled` 或 `disabled` |
| `is_default` / `isDefault` | 是否为默认文件服务 |
| `base_path` / `basePath` | 对象键基础路径 |
| `remark` | 备注 |

### 本地磁盘：`local`

适用于开发环境、内网部署或单机文件存储。

| 配置项 | 说明 |
| --- | --- |
| `localRootPath` | 本地存储根目录；相对路径按服务端 `process.cwd()` 解析 |

代码默认根目录常量为 `storage/local`。读取、删除时按 `objectKey` 拼接实际文件路径。

### 阿里云 OSS：`oss`

通过 `ali-oss` SDK 写入、读取和删除对象。

| 配置项 | 说明 |
| --- | --- |
| `ossRegion` | OSS Region |
| `ossEndpoint` | OSS Endpoint |
| `ossBucket` | Bucket |
| `ossAccessKeyId` | AccessKey ID |
| `ossAccessKeySecret` | AccessKey Secret |

### S3 兼容存储：`s3`

通过 AWS SDK v3 访问 AWS S3、MinIO、Cloudflare R2 等 S3 兼容服务。

| 配置项 | 说明 |
| --- | --- |
| `s3Region` | Region |
| `s3Endpoint` | 自定义 Endpoint，可用于兼容存储 |
| `s3Bucket` | Bucket |
| `s3AccessKeyId` | Access Key ID |
| `s3SecretAccessKey` | Secret Access Key |
| `s3ForcePathStyle` | 是否启用 path-style 访问，默认 `false` |

### 腾讯云 COS：`cos`

通过 `cos-nodejs-sdk-v5` 访问腾讯云 COS。

| 配置项 | 说明 |
| --- | --- |
| `cosRegion` | COS Region |
| `cosBucket` | Bucket |
| `cosSecretId` | SecretId |
| `cosSecretKey` | SecretKey |

### 华为云 OBS：`obs`

通过 `esdk-obs-nodejs` 访问华为云 OBS。

| 配置项 | 说明 |
| --- | --- |
| `obsEndpoint` | OBS Endpoint |
| `obsBucket` | Bucket |
| `obsAccessKeyId` | Access Key ID |
| `obsSecretAccessKey` | Secret Access Key |

### 七牛云 Kodo：`kodo`

通过 `qiniu` SDK 上传、删除对象；读取时使用 `BucketManager.privateDownloadUrl()` 生成临时下载地址。

| 配置项 | 说明 |
| --- | --- |
| `kodoAccessKey` | Access Key |
| `kodoSecretKey` | Secret Key |
| `kodoBucket` | Bucket |
| `kodoRegion` | 七牛 Zone 名称，可选 |
| `kodoEndpoint` | 下载域名，用于生成私有下载 URL |

### 百度云 BOS：`bos`

通过 `@baiducloud/sdk` 访问百度云 BOS。

| 配置项 | 说明 |
| --- | --- |
| `bosEndpoint` | BOS Endpoint |
| `bosBucket` | Bucket |
| `bosAccessKeyId` | Access Key ID |
| `bosSecretAccessKey` | Secret Access Key |

### Azure Blob Storage：`azure`

通过 `@azure/storage-blob` 访问 Azure Blob Storage。

| 配置项 | 说明 |
| --- | --- |
| `azureAccountName` | Storage Account 名称 |
| `azureAccountKey` | Storage Account Key |
| `azureContainerName` | Blob Container 名称 |
| `azureEndpoint` | 自定义服务地址；为空时使用 `https://{accountName}.blob.core.windows.net` |

### SFTP：`sftp`

通过 `ssh2-sftp-client` 连接远端服务器并写入文件。

| 配置项 | 说明 |
| --- | --- |
| `sftpHost` | SFTP 主机 |
| `sftpPort` | 端口，默认 `22` |
| `sftpUsername` | 用户名 |
| `sftpPassword` | 密码 |
| `sftpPrivateKey` | SSH 私钥；存在时优先使用私钥登录 |
| `sftpRootPath` | 远端根目录 |
| `sftpBaseUrl` | 访问 Base URL 字段；文件内容仍统一经 `/api/files/{id}/content` 读取 |

### 默认存储切换

- 上传时查询 `file_storage_configs` 中 `is_default = true` 且 `status = 'enabled'` 的配置。
- 创建配置时，如果当前没有默认配置且新配置为启用状态，会自动成为默认配置。
- 默认配置不能被禁用或删除；切换默认服务会先清除其它配置的 `is_default`。
- `managed_files.bucket_name` 会快照对象存储的 Bucket / Container 名称，避免后续修改配置导致历史文件无法读取。

### 密钥脱敏（write-only）

- 存储配置中的密钥字段（`ossAccessKeySecret`、`s3SecretAccessKey`、`cosSecretKey`、`obsSecretAccessKey`、`kodoSecretKey`、`bosSecretAccessKey`、`azureAccountKey`、`sftpPassword`、`sftpPrivateKey`）**不会在列表 / 详情接口中返回**。
- 编辑配置时密钥框默认留空，**留空表示沿用原密钥**，仅在填入新值时才覆盖（write-only）。
- `AccessKeyId / SecretId / AccountName` 等标识类字段仍会返回，用于识别当前配置。

---

## 上传安全

上传逻辑位于 `packages/server/src/services/files.service.ts`。

### Magic Bytes 真实类型校验

上传文件时默认启用真实类型校验：

1. 读取文件前 `4100` 字节。
2. 使用 `file-type` 的 `fileTypeFromBuffer()` 识别真实 MIME 类型。
3. 若无法识别（如纯文本），回退使用上传请求中的 `file.type`。
4. 将实际 MIME 与允许类型白名单匹配；支持 `image/*` 这类通配符。
5. 不匹配时返回 400，提示检测到的 MIME 不在允许列表中。

### 系统配置项

系统配置种子位于 `packages/shared/src/seed-data.ts`：

| Key | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `file_upload_validate_type` | `boolean` | `true` | 是否启用 Magic Bytes 真实类型校验 |
| `file_upload_allowed_types` | `string` | `image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/msword,application/vnd.ms-powerpoint` | 允许上传的 MIME 类型，逗号分隔，支持 `*`、`*/*` 和 `type/*` |
| `file_upload_max_size_mb` | `number` | `0` | 单个文件上传大小上限（MB），`0` 表示不限制；普通上传与分片上传初始化均会校验 |
| `upload_session_ttl_hours` | `number` | `24` | 分片上传会话保留时长（小时）；超过仍未完成的会话及其临时分片由定时任务清理 |

普通上传与分片上传在服务端均按 `file_upload_max_size_mb` 校验大小；另有运行时请求体限制、反向代理限制等共同生效，全局请求体限制见[安全体系](../backend/security.md)。

### 内容读取安全头

`GET /api/files/{id}/content` 返回文件内容时：

- `Content-Type` 使用文件记录的 `mimeType`，缺省为 `application/octet-stream`。
- 仅图片、音视频和 PDF 使用 `inline`；其它 MIME 统一使用 `attachment`，避免 HTML、SVG、XML、JS 等内容被浏览器直接执行。
- 响应头包含 `X-Content-Type-Options: nosniff`。
- 响应头包含 `ETag`、`Last-Modified`、`Cache-Control: private, max-age=3600`，支持 `If-None-Match` / `If-Modified-Since` 条件请求返回 `304`。
- `local` 与 `s3` provider 支持 `Range` 请求并返回 `206 Partial Content`，用于本地文件和 S3 兼容存储的视频拖动、大文件断点下载；非法 Range 返回 `416` 与 `Content-Range: bytes */{size}`。其它 provider 当前仍优雅回退为完整 `200` 流式响应。

---

## 文件管理能力

### 上传

- `POST /api/files/upload` 支持 multipart 多文件上传，权限为 `system:file:upload`。
- `POST /api/files/upload-one` 支持单文件上传，使用登录态鉴权。
- 前端文件管理页使用 `XMLHttpRequest` 上传，以便展示每个文件的上传进度。
- 上传成功后写入 `managed_files`，返回统一访问 URL：`/api/files/{id}/content`，其中 `{id}` 为 `managed_files.id`（UUIDv7 字符串），不是自增数字。

#### 分片上传与断点续传

大文件（前端默认 > 5MB）走分片上传，状态持久化在 `upload_sessions` / `upload_chunks` 两张表，支持并发上传、失败重试与断点续传：

- `POST /api/files/upload/init` 初始化会话：校验大小上限、快照默认存储与 `objectKey`，返回 `uploadId / chunkSize / totalChunks / received`。
- `POST /api/files/upload/chunk` 上传单个分片（multipart：`uploadId` / `index` / `chunk`）；分片以 `unique(upload_session_id, index)` 幂等记录，天然并发安全。
- `POST /api/files/upload/complete` 校验分片完整 + Magic Bytes 类型校验后，按序流式合并并写入存储，落库 `managed_files`。
- `GET /api/files/upload/{uploadId}/status` 返回已接收分片序号，用于断点续传。
- `DELETE /api/files/upload/{uploadId}` 中止会话并清理临时分片。
- 存储路径：**OSS / S3（含 MinIO / Cloudflare R2 等 S3 兼容）/ COS / OBS / Azure Blob / BOS 已接入云原生 multipart / block upload**——分片直传云端、记录 ETag（Azure 记录 blockId），`complete` 时由云端合并，服务器不暂存整文件；`local / sftp / kodo` 走本地临时目录暂存 + 流式合并。Kodo 的 Node SDK 不暴露可外部控制的 `uploadId / part / etag`，暂保留回退路径。
- 前端工具位于 `packages/web/src/utils/chunked-upload.ts`，`uploadId` 持久化到 `localStorage`，刷新或重新选择同一文件可续传。
- **临时分片**（仅暂存路径）存于 `packages/server/storage/tmp/uploads/{uploadId}/{index}`。完成（`complete`）或中止（`abort`）时立即删除会话目录；云原生路径在 `abort` 时调用云端 `AbortMultipartUpload`。对**中断未完成**的会话，由定时任务 `cleanupUploadSessions`（默认每天 4:30）按 `upload_session_ttl_hours`（默认 24 小时）清理过期会话、临时分片、孤儿目录并中止残留的云端 multipart（孤儿目录额外做 mtime 校验，避免误删进行中的上传）。

### 存储连接测试

- `POST /api/file-storage-configs/test` 用于测试新增表单中的配置，会写入并删除一个 `.zenith-test/*.txt` 临时对象，验证写入、路径 / bucket 权限与删除权限。
- `POST /api/file-storage-configs/{id}/test` 用于测试已保存配置；编辑模式下密钥字段留空时沿用数据库原密钥（write-only），避免为测试而回显密钥。
- 前端文件配置页提供列表行「测试」按钮和弹窗内「测试连接」按钮；测试接口开启审计但 `recordBody:false`，避免密钥进入审计日志。

### 列表与筛选

`GET /api/files` 返回分页列表，支持：

- `keyword`：匹配文件名、对象键、存储服务名称。
- `provider`：存储类型，支持 `local / oss / s3 / cos / obs / kodo / bos / azure / sftp`。
- `fileType`：`image / video / audio / document`。
- `startTime`、`endTime`：按创建时间筛选，入参使用 `YYYY-MM-DD HH:mm:ss`。

### 预览与下载

- 图片通过 Semi Design `ImagePreview` 预览，并按当前页图片列表支持切换。
- 非图片预览交给 `FilePreviewModal`，详见[文件预览组件](../frontend/file-preview.md)。
- 下载通过 `fetchProtectedFile()` 拉取 Blob 后触发浏览器下载。
- 文件详情展示文件名、存储服务、MIME 类型、大小、上传人、对象键、访问链接、上传时间；图片详情会尝试读取分辨率。

### 删除与批量操作

- `DELETE /api/files/{id}` 删除单个文件记录，并同步尝试删除实际存储对象。
- `DELETE /api/files/batch` 批量删除文件；单个对象删除失败不会阻断整体数据库记录删除。
- `POST /api/files/batch-download` 将选中文件打包为 ZIP 流式响应；读取失败的单个文件会被跳过。

### 存储浏览

`GET /api/files/browse` 根据 `storageConfigId` 和 `path` 浏览存储目录。当前实现基于 `managed_files.object_key` 前缀构造目录树，不直接枚举远端 Bucket。路径会拒绝 `.` 和 `..` 片段，避免目录穿越。

### 文件统计

`GET /api/files/stats` 返回：

- 汇总：文件总数、总大小、图片 / 文档 / 视频 / 音频数量、今日上传、本月上传。
- 分布：文件类型、存储 provider、文件大小区间。
- 趋势：近 12 个月每月上传数量。
- 上传人：按文件数统计 Top 上传人。

---

## 业务文件

业务文件由 `business_files` 表维护文件与业务实体的多态关联。

当前业务类型枚举为：

| businessType | 说明 |
| --- | --- |
| `announcement` | 通知公告附件 |

能力：

- `GET /api/business-files/{businessType}/{businessId}` 查询业务记录附件。
- `DELETE /api/business-files/{businessType}/{businessId}/{fileId}` 移除业务附件关联。
- `saveBusinessFiles()` 会先删除原有关联，再校验文件存在且属于当前租户，最后按 `fileIds` 顺序写入新关联。
- `business_files.file_id` 外键指向 `managed_files.id`，文件删除时关联记录级联删除。

通知公告服务也直接使用 `business_files` 保存和读取公告附件，前端通过 `FileAttachment` 组件在编辑与只读模式下复用上传、预览、下载与移除能力。

---

## 接口一览

### 文件接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/files/{id}/content` | 公开内容读取路由 | 读取文件内容 |
| `GET` | `/api/files` | `system:file:list` | 文件分页列表 |
| `GET` | `/api/files/stats` | `system:file:list` | 文件统计分析 |
| `GET` | `/api/files/browse` | `system:file:list` | 按存储配置浏览目录 |
| `GET` | `/api/files/{id}` | `system:file:list` | 获取文件详情 |
| `GET` | `/api/files/{id}/sheet-preview` | `system:file:list` | 获取 Excel / CSV 表格预览数据 |
| `POST` | `/api/files/upload` | `system:file:upload` | 上传一个或多个文件 |
| `POST` | `/api/files/upload-one` | 登录态 | 上传单个文件 |
| `POST` | `/api/files/upload/init` | 登录态 | 初始化分片上传 |
| `POST` | `/api/files/upload/chunk` | 登录态 | 上传单个分片 |
| `POST` | `/api/files/upload/complete` | 登录态 | 完成并合并分片 |
| `GET` | `/api/files/upload/{uploadId}/status` | 登录态 | 查询分片进度（断点续传） |
| `DELETE` | `/api/files/upload/{uploadId}` | 登录态 | 中止分片上传 |
| `DELETE` | `/api/files/{id}` | `system:file:delete` | 删除文件 |
| `DELETE` | `/api/files/batch` | `system:file:delete` | 批量删除文件 |
| `POST` | `/api/files/batch-download` | `system:file:list` | 批量下载 ZIP |

### 存储配置接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/file-storage-configs` | `system:file:config` | 存储配置分页列表 |
| `GET` | `/api/file-storage-configs/default` | `system:file:config` | 获取默认配置 |
| `GET` | `/api/file-storage-configs/{id}` | `system:file:config` | 获取配置详情 |
| `POST` | `/api/file-storage-configs` | `system:file:config:create` | 创建配置 |
| `PUT` | `/api/file-storage-configs/{id}` | `system:file:config:update` | 更新配置 |
| `PUT` | `/api/file-storage-configs/{id}/default` | `system:file:config:default` | 设为默认 |
| `DELETE` | `/api/file-storage-configs/{id}` | `system:file:config:delete` | 删除配置 |

### 业务附件接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/business-files/{businessType}/{businessId}` | 登录态 | 获取业务附件列表 |
| `DELETE` | `/api/business-files/{businessType}/{businessId}/{fileId}` | `system:file:delete` | 移除业务附件关联 |

---

## 数据模型

### `file_storage_configs`

文件存储配置表。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键（数字 ID，存储配置仍使用自增 ID） |
| `name` | 配置名称 |
| `provider` | `file_storage_provider` 枚举：`local / oss / s3 / cos / obs / kodo / bos / azure / sftp` |
| `status` | `enabled / disabled` |
| `is_default` | 是否默认 |
| `base_path` | 对象键基础路径 |
| `local_root_path` | 本地存储根目录 |
| `oss_region`、`oss_endpoint`、`oss_bucket`、`oss_access_key_id`、`oss_access_key_secret` | OSS 配置 |
| `s3_region`、`s3_endpoint`、`s3_bucket`、`s3_access_key_id`、`s3_secret_access_key`、`s3_force_path_style` | S3 配置 |
| `cos_region`、`cos_bucket`、`cos_secret_id`、`cos_secret_key` | COS 配置 |
| `obs_endpoint`、`obs_bucket`、`obs_access_key_id`、`obs_secret_access_key` | OBS 配置 |
| `kodo_access_key`、`kodo_secret_key`、`kodo_bucket`、`kodo_region`、`kodo_endpoint` | Kodo 配置 |
| `bos_endpoint`、`bos_bucket`、`bos_access_key_id`、`bos_secret_access_key` | BOS 配置 |
| `azure_account_name`、`azure_account_key`、`azure_container_name`、`azure_endpoint` | Azure Blob 配置 |
| `sftp_host`、`sftp_port`、`sftp_username`、`sftp_password`、`sftp_private_key`、`sftp_root_path`、`sftp_base_url` | SFTP 配置 |
| `remark` | 备注 |
| 审计字段 | `created_by`、`updated_by` 等通用审计字段 |
| `created_at`、`updated_at` | 创建与更新时间 |

### `managed_files`

托管文件记录表。

| 字段 | 说明 |
| --- | --- |
| `id` | UUIDv7 主键（应用层生成，对外 URL 使用该值，避免自增 ID 可枚举） |
| `storage_config_id` | 关联 `file_storage_configs.id`，删除策略为 `restrict` |
| `storage_name` | 上传时的存储配置名称快照 |
| `provider` | 上传时的存储 provider |
| `original_name` | 原始文件名 |
| `object_key` | 存储对象键 |
| `bucket_name` | Bucket / Container 快照；`local`、`sftp` 为空 |
| `size` | 文件大小，单位字节 |
| `mime_type` | MIME 类型 |
| `extension` | 扩展名 |
| `tenant_id` | 租户 ID |
| 审计字段 | 上传人与更新人等审计字段 |
| `created_at`、`updated_at` | 创建与更新时间 |

### `business_files`

业务文件关联表。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `business_type` | 业务类型枚举，当前为 `announcement` |
| `business_id` | 业务记录 ID |
| `file_id` | UUID，关联 `managed_files.id`，删除文件时级联删除 |
| `name` | 业务侧展示名称 |
| `category` | 业务分类 |
| `sort_order` | 排序值 |
| `tenant_id` | 租户 ID |
| `created_at` | 创建时间 |

唯一约束：`business_type + business_id + file_id`。

---

## 前端

### 文件配置页

文件配置页位于 `packages/web/src/pages/system/file-configs/FileStorageConfigsPage.tsx`，菜单路径为 `/system/file-configs`。

能力：

- 按状态、更新时间筛选配置。
- 创建、编辑、删除、启用 / 禁用配置。
- 设置默认文件服务。
- 打开 `StorageFileBrowser` 浏览指定配置下的文件目录。
- 表单提供 9 种 provider 配置项。

### 文件列表页

文件列表页位于 `packages/web/src/pages/system/files/FilesPage.tsx`，菜单路径为 `/system/files`。

能力：

- 文件列表 / 网格双视图。
- 按关键字、存储类型、文件类型、上传时间筛选。
- 多文件上传与进度展示。
- 文件预览、下载、详情、复制链接、删除。
- 批量下载 ZIP、批量删除、取消选择。
- 统计 Tab 通过 `FileStatsPanel` 展示文件统计图表。

### 业务附件组件

`packages/web/src/components/FileAttachment/index.tsx` 提供业务附件组件：

- `edit` 模式：上传、删除、进度、数量限制、大小限制。
- `view` 模式：只读展示附件。
- 复用统一文件预览组件和图片预览能力。
- 上传接口使用 `/api/files/upload-one`。

### 文件预览组件

统一预览组件位于 `packages/web/src/components/FilePreviewModal/index.tsx`，详细能力见[文件预览组件](../frontend/file-preview.md)。

---

## 相关文档

- [文件预览组件](../frontend/file-preview.md)
- [安全体系](../backend/security.md)
- [功能模块](../product/features.md)

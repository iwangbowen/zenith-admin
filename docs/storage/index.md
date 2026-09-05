# 文件与存储

本页描述 Zenith Admin 当前文件与存储实现：统一文件记录、上传下载、预览、分片上传、业务附件、存储后端与访问 URL 策略。事实来源以 `packages\server\src\routes\files`、`packages\server\src\services\files`、`packages\server\src\lib\file-storage.ts`、`packages\shared\src\platform` 为准。

本页对应独立的 `files` 路由领域，专题地址沿用 `/storage/`。文件契约虽放在共享层 `platform` 下，但不由 `platform` 路由领域挂载；平台能力见[平台基础能力](../platform/index.md)，空间与协作权限见[企业网盘](../drive/index.md)。

## 模块边界

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 共享契约 | `packages\shared\src\platform\contracts\` 下的 `files.ts`、`file-storage-configs.ts`、`business-files.ts` | 文件实体 schema 与 API 操作；同域 `constants.ts`、`validation.ts` 提供存储枚举与输入校验 |
| 数据模型 | `packages\server\src\db\schema\files.ts` | 存储配置、托管文件、分片上传会话、分片记录、业务附件关联 |
| 存储适配 | `packages\server\src\lib\file-storage.ts` | 对象 key、SDK 懒加载、上传、读取、删除、公开/签名/代理 URL、multipart 驱动 |
| 服务层 | `packages\server\src\services\files` | 文件列表/上传/删除/统计/浏览、配置 CRUD、业务附件、分片上传会话 |
| HTTP 路由 | `packages\server\src\routes\files` | `/api/files`、`/api/file-storage-configs`、`/api/business-files` |
| 前端页面 | `packages\web\src\pages\system\files`、`file-configs` 及业务附件组件 | 文件列表、存储配置、上传、预览、下载、业务附件 |

## 数据模型

| 表 | 说明 |
| --- | --- |
| `file_storage_configs` | 存储配置；provider、状态、默认标识、basePath、objectAcl、urlStrategy、publicBaseUrl、presignedExpirySeconds 与各 provider 专属字段 |
| `managed_files` | 统一文件记录；UUID 主键、storageConfigId、storageName、provider、originalName、objectKey、bucketName、size（bigint）、mimeType、extension、objectAcl、visibility、contentHash、tenantId、审计字段 |
| `upload_sessions` | 分片上传会话；uploadId、文件名/大小/MIME、chunkSize、totalChunks、存储配置快照、multipartUploadId、状态、租户、审计字段 |
| `upload_chunks` | 已上传分片；uploadSessionId、index、size、etag；`uploadSessionId + index` 唯一保证重传幂等 |
| `business_files` | 业务附件关联；`businessType + businessId + fileId` 唯一，当前枚举为 `announcement`、`wiki_doc` |

`managed_files.bucketName` 与 `objectAcl` 是上传时快照，用于在存储配置后续切换 bucket 或 ACL 时继续读取旧文件并正确判断公开直链能力。

`managed_files.visibility` 区分 `public`（默认，可经无需登录的 `/api/files/{id}/content` 读取）与 `restricted`（业务域自管访问控制，通用内容接口返回 404，只能经业务域自己的内容接口读取，如企业网盘的 `/api/drive/nodes/{id}/content`）。文件管理列表默认只展示 `public` 文件。`contentHash` 为可选的 SHA-256，供业务域按内容去重 / 秒传。

## 存储后端

当前 provider 枚举为 `local`、`oss`、`s3`、`cos`、`obs`、`kodo`、`bos`、`azure`、`sftp`。

| provider | 显示名 | 必填配置 | 读写实现 |
| --- | --- | --- | --- |
| `local` | 本地磁盘 | `localRootPath` | 写入 `localRootPath`（相对路径按进程 cwd 解析），代理读取支持 Range |
| `oss` | 阿里云 OSS | `ossRegion`、`ossEndpoint`、`ossBucket`、`ossAccessKeyId`、`ossAccessKeySecret` | `ali-oss` 懒加载，支持上传、读取、删除、签名 URL、原生 multipart |
| `s3` | S3 兼容存储 | `s3Region`、`s3Bucket`、`s3AccessKeyId`、`s3SecretAccessKey`；可选 `s3Endpoint`、`s3ForcePathStyle` | AWS SDK v3，兼容 AWS S3 / MinIO / R2，代理读取支持 Range，支持签名 URL 与原生 multipart |
| `cos` | 腾讯云 COS | `cosRegion`、`cosBucket`、`cosSecretId`、`cosSecretKey` | `cos-nodejs-sdk-v5`，支持签名 URL 与原生 multipart；对象 ACL 不支持 `public-read-write` |
| `obs` | 华为云 OBS | `obsEndpoint`、`obsBucket`、`obsAccessKeyId`、`obsSecretAccessKey` | `esdk-obs-nodejs`，支持签名 URL 与原生 multipart |
| `kodo` | 七牛云 Kodo | `kodoAccessKey`、`kodoSecretKey`、`kodoBucket`；可选 `kodoRegion`、`kodoEndpoint` | 七牛 SDK 表单上传；签名下载依赖 `publicBaseUrl` 或 `kodoEndpoint`；分片走本地暂存合并 |
| `bos` | 百度云 BOS | `bosEndpoint`、`bosBucket`、`bosAccessKeyId`、`bosSecretAccessKey` | `@baiducloud/sdk`，支持签名 URL 与原生 multipart |
| `azure` | Azure Blob | `azureAccountName`、`azureAccountKey`、`azureContainerName`；可选 `azureEndpoint` | `@azure/storage-blob`，支持 SAS URL 与 block list multipart；Azure staged blocks 无显式 abort，未提交块由云端过期 |
| `sftp` | SFTP | `sftpHost`、`sftpUsername`；可选 `sftpPort`、`sftpPassword`、`sftpPrivateKey`、`sftpRootPath`、`sftpBaseUrl` | `ssh2-sftp-client`，上传前递归建目录；分片走本地暂存合并 |

云 SDK 使用 `createRequire` 懒加载，只在对应 provider 首次使用时加载，降低 Server 启动成本。

## 访问 URL 策略与 ACL

`FILE_URL_STRATEGIES`：

| 策略 | 行为 |
| --- | --- |
| `proxy` | 返回稳定代理地址 `/api/files/{id}/content`，由服务端读取对象并响应 |
| `public` | 优先使用 `publicBaseUrl`，否则按 provider 拼接公开直链；若 ACL/配置无法证明公开可读，则降级签名或代理 |
| `presigned` | 使用 provider SDK 生成临时签名 URL，过期时间为 `presignedExpirySeconds`，默认 1800 秒，允许范围 60 到 604800 秒 |

对象 ACL 枚举为 `default`、`private`、`public-read`、`public-read-write`。支持矩阵：

| provider | 对象级 ACL |
| --- | --- |
| `oss`、`s3`、`obs` | `default`、`private`、`public-read`、`public-read-write` |
| `cos`、`bos` | `default`、`private`、`public-read` |
| `local`、`kodo`、`azure`、`sftp` | 不支持对象级 ACL，上传时不发送 ACL 参数 |

`public` 策略下，支持对象级 ACL 的云存储必须在文件快照中记录为 `public-read` 或 `public-read-write` 才返回公开直链；`local`、`kodo`、`azure`、`sftp` 信任管理员配置的公开访问域名/下载域名。

## 上传、下载与预览

### 普通上传

`POST /api/files/upload` 支持多文件字段 `file`，返回 `ManagedFile[]`；`POST /api/files/upload-one` 返回单个 `ManagedFile`。两者都使用当前启用的默认存储配置：

1. 校验文件大小，系统配置 `file_upload_max_size_mb` 为 0 表示不限制。
2. 读取文件前 4100 字节做 Magic Bytes 检测；系统配置 `file_upload_validate_type` 默认开启。
3. 允许类型来自 `file_upload_allowed_types`，支持精确 MIME、`type/*`、`*`、`*/*`。
4. 无法通过 Magic Bytes 识别的文本类文件回退到上传方提供的 MIME。
5. 生成对象 key：`basePath/YYYY/MM/DD/{timestamp}-{random}.{ext}`。
6. 上传到 provider 后写入 `managed_files`。

通用 `files` API 没有独立的秒传接口；分片接口使用 `uploadId + index` 保证同一分片重传幂等，但不按内容 hash 跳过整文件上传。`managed_files.contentHash` 已支持持久化，网盘在此底座上实现自己的预检查与秒传，详见[企业网盘：存储集成](../drive/index.md#存储集成)。

### 分片上传

分片接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/files/upload/init` | 初始化上传会话，校验文件大小，选择默认存储，返回 `uploadId`、`chunkSize`、`totalChunks`、`received` |
| POST | `/api/files/upload/chunk` | 上传单片；index 从 0 开始，首片执行 Magic Bytes 校验 |
| POST | `/api/files/upload/complete` | 校验分片完整后完成上传并写入 `managed_files` |
| GET | `/api/files/upload/{uploadId}/status` | 查询已接收分片与会话状态 |
| DELETE | `/api/files/upload/{uploadId}` | 中止上传并清理临时目录或云端 multipart |

`oss`、`s3`、`cos`、`obs`、`azure`、`bos` 使用原生 multipart；`local`、`kodo`、`sftp` 使用 `storage/tmp/uploads` 本地暂存后流式合并。`upload_chunks` 的唯一约束允许客户端安全重传同一分片。

过期分片由 `cleanupStaleUploadSessions(ttlHours)` 清理：删除过期会话及其分片，尝试中止云端 multipart，并清理无活跃会话的孤儿临时目录。该清理能力接入统一数据保留策略。

### 下载与预览

| API | 行为 |
| --- | --- |
| `GET /api/files/{id}/content` | 公开读取文件内容；返回 `ETag`、`Last-Modified`、`Cache-Control: private, max-age=3600`、`X-Content-Type-Options: nosniff`；`local` 和 `s3` 支持 Range，合法 Range 返回 206，非法 Range 返回 416 |
| `GET /api/files/{id}/access-url?purpose=preview\|download` | 登录态解析文件访问地址；按配置返回 `public`、`presigned` 或 `proxy`，签名 URL 响应使用 `Cache-Control: private, no-store` |

可内联预览 MIME 白名单：JPEG/JPG/PNG/GIF/WebP/BMP/ICO、MP4/WebM/OGG 视频、MP3/OGG/WAV/WebM 音频、PDF。SVG、HTML、XML、JS 等可能含脚本的类型一律 `attachment` 下载，防止 Stored XSS。

## 文件管理能力

| 能力 | API | 权限 |
| --- | --- | --- |
| 文件列表 | `GET /api/files`，支持 `keyword`、`provider`、`fileType`、`startTime`、`endTime` | `system:file:list` |
| 文件详情 | `GET /api/files/{id}` | `system:file:list` |
| 文件统计 | `GET /api/files/stats` | `system:file:list` |
| 浏览存储配置目录 | `GET /api/files/browse?storageConfigId=&path=` | `system:file:list` |
| 普通上传 | `POST /api/files/upload`、`POST /api/files/upload-one` | `system:file:upload` |
| 分片上传 | `POST /api/files/upload/init`、`POST /api/files/upload/chunk`、`POST /api/files/upload/complete`、`GET /api/files/upload/{uploadId}/status`、`DELETE /api/files/upload/{uploadId}` | 写入阶段 `system:file:upload`；状态查询仅需登录 |
| 删除 | `DELETE /api/files/{id}`、`DELETE /api/files/batch` | `system:file:delete` |
| 批量下载 | `POST /api/files/batch-download` | `system:file:list` |

文件统计返回总文件数、总大小、图片/文档/视频/音频数量、今日/本月上传数、类型分布、provider 分布、月度趋势、上传者排行与大小区间分布。

## 存储配置能力

存储配置 API 根路径为 `/api/file-storage-configs`：

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/file-storage-configs` | 分页列表，支持状态与时间范围 | `system:file:config` |
| GET | `/api/file-storage-configs/default` | 默认配置 | `system:file:config` |
| GET | `/api/file-storage-configs/{id}` | 详情 | `system:file:config` |
| POST | `/api/file-storage-configs/test` | 测试未保存配置 | `system:file:config` |
| POST | `/api/file-storage-configs/{id}/test` | 测试已保存配置，可叠加临时修改 | `system:file:config` |
| POST | `/api/file-storage-configs` | 创建配置 | `system:file:config:create` |
| PUT | `/api/file-storage-configs/{id}` | 更新配置 | `system:file:config:update` |
| PUT | `/api/file-storage-configs/{id}/default` | 设为默认 | `system:file:config:default` |
| DELETE | `/api/file-storage-configs/{id}` | 删除配置 | `system:file:config:delete` |

密钥字段为 write-only：`ossAccessKeySecret`、`s3SecretAccessKey`、`cosSecretKey`、`obsSecretAccessKey`、`kodoSecretKey`、`bosSecretAccessKey`、`azureAccountKey`、`sftpPassword`、`sftpPrivateKey`。列表/详情不回显密钥原文；更新时未传密钥保留原值，传空值表示清空。删除存储配置前会检查 `managed_files.storageConfigId`，有文件使用时不允许删除。

## 业务附件

业务附件通过 `business_files` 做多态关联，不复制文件本体。当前业务类型为 `announcement`、`wiki_doc`。

| API | 说明 | 权限 |
| --- | --- | --- |
| `GET /api/business-files/{businessType}/{businessId}` | 获取业务附件列表 | 登录态 |
| `DELETE /api/business-files/{businessType}/{businessId}/{fileId}` | 移除业务与文件的关联 | `system:file:delete` |

业务附件返回 `file.url`（稳定代理地址）与可选 `file.directUrl`（仅公开策略渲染用）。删除业务附件只移除关联；删除托管文件会移除对象存储中的对象并删除 `managed_files` 记录。

## 前端入口与菜单

菜单种子位于 `packages\shared\src\seed\menus\settings.ts`：

| 页面 | 路由 | 权限 |
| --- | --- | --- |
| 文件配置 | `/system/file-configs` | `system:file:config`、`system:file:config:create`、`system:file:config:update`、`system:file:config:delete`、`system:file:config:default` |
| 文件列表 | `/system/files` | `system:file:list`、`system:file:upload`、`system:file:delete` |

文件列表页面消费 `ManagedFile.url` 做稳定代理访问，按需用 `GET /api/files/{id}/access-url` 获取预览/下载直链。可公开访问的文件内容接口仍通过文件 ID 查库读取，不暴露 provider 密钥或对象存储内部配置。

## 维护要求

- 新增 provider 必须同步更新 `FILE_STORAGE_PROVIDERS`、Drizzle 枚举、Zod schema、契约实体 / 前端表单、上传/读取/删除/签名 URL 逻辑与必要 SDK 懒加载。
- 修改 ACL 或 URL 策略时同时核对 `FILE_OBJECT_ACL_SUPPORT`、`resolveObjectAcl()`、`buildPublicFileUrl()`、`resolveFileAccessUrl()`。
- 上传能力变更需要同步普通上传、分片上传、Magic Bytes 校验与业务附件组件。
- 区分通用文件上传与业务域秒传：存在 `contentHash` 字段不代表通用上传接口会跳过传输，网盘秒传行为在网盘专题维护。

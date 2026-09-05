/**
 * 运维域枚举常量（pg enum / TS union / 前端展示三端共用）。
 */
import { createLabelOptions } from '../core/enum-options';

// ─── 维护模式 ────────────────────────────────────────────────────────────────

export const MAINTENANCE_LOG_STATUSES = ['ongoing', 'completed'] as const;
export type MaintenanceLogStatus = (typeof MAINTENANCE_LOG_STATUSES)[number];

// ─── SSL 证书 ────────────────────────────────────────────────────────────────

export const SSL_CERT_TYPES = ['self_signed', 'uploaded', 'letsencrypt'] as const;
export type SslCertType = (typeof SSL_CERT_TYPES)[number];

export const SSL_CERT_STATUSES = ['valid', 'expiring', 'expired', 'invalid'] as const;
export type SslCertStatus = (typeof SSL_CERT_STATUSES)[number];

/** 证书下载文件类型：公钥证书 / 私钥 */
export const SSL_CERT_DOWNLOAD_KINDS = ['cert', 'key'] as const;
export type SslCertDownloadKind = (typeof SSL_CERT_DOWNLOAD_KINDS)[number];

// ─── 数据库备份 ──────────────────────────────────────────────────────────────

export const DB_BACKUP_TYPES = ['pg_dump', 'drizzle_export'] as const;
export type DbBackupType = (typeof DB_BACKUP_TYPES)[number];

export const DB_BACKUP_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export type DbBackupStatus = (typeof DB_BACKUP_STATUSES)[number];

// ─── 数据库管理 ──────────────────────────────────────────────────────────────

/** table=普通表 view=视图 matview=物化视图 */
export const DB_ADMIN_TABLE_KINDS = ['table', 'view', 'matview'] as const;
export type DbAdminTableKind = (typeof DB_ADMIN_TABLE_KINDS)[number];

export const DB_ADMIN_MAINTENANCE_ACTIONS = ['vacuum', 'vacuum_analyze', 'analyze', 'reindex'] as const;
export type DbAdminMaintenanceAction = (typeof DB_ADMIN_MAINTENANCE_ACTIONS)[number];

/** 表 SQL 导出范围：ddl=仅结构 data=仅数据 full=结构 + 数据 */
export const DB_ADMIN_SQL_EXPORT_MODES = ['ddl', 'data', 'full'] as const;
export type DbAdminSqlExportMode = (typeof DB_ADMIN_SQL_EXPORT_MODES)[number];

export const DB_ADMIN_COLUMN_DIFF_ISSUES = ['missing_in_db', 'extra_in_db', 'type_mismatch', 'nullable_mismatch'] as const;
export type DbAdminColumnDiffIssue = (typeof DB_ADMIN_COLUMN_DIFF_ISSUES)[number];

export const DB_ADMIN_TABLE_DRIFT_STATUSES = ['missing_in_db', 'extra_in_db', 'column_diff'] as const;
export type DbAdminTableDriftStatus = (typeof DB_ADMIN_TABLE_DRIFT_STATUSES)[number];

// ─── 数据保留策略 ────────────────────────────────────────────────────────────

/**
 * 清理模式：
 * - `age`       按时间列裁剪超期行
 * - `ageAndCap` 在 `age` 之上，再按分组保留最近 N 行
 * - `expiresAt` 按行内到期列裁剪（保留天数 = 到期后的宽限天数）
 * - `custom`    删除逻辑委托给领域函数（跨表条件、文件副作用等），天数仍由本策略配置
 */
export const RETENTION_MODES = ['age', 'ageAndCap', 'expiresAt', 'custom'] as const;
export type RetentionMode = (typeof RETENTION_MODES)[number];

// ─── 防火墙 ──────────────────────────────────────────────────────────────────

export const FIREWALL_TYPES = ['ufw', 'firewalld', 'iptables', 'unknown'] as const;
export type FirewallType = (typeof FIREWALL_TYPES)[number];

export const FIREWALL_RULE_TYPES = ['allow', 'deny', 'reject'] as const;
export type FirewallRuleType = (typeof FIREWALL_RULE_TYPES)[number];

export const FIREWALL_PROTOCOLS = ['tcp', 'udp', 'any'] as const;
export type FirewallProtocol = (typeof FIREWALL_PROTOCOLS)[number];

export const FIREWALL_DIRECTIONS = ['in', 'out', 'any'] as const;
export type FirewallDirection = (typeof FIREWALL_DIRECTIONS)[number];

// ─── Nginx 站点 ──────────────────────────────────────────────────────────────

export const NGINX_RUNNING_STATUSES = ['running', 'stopped', 'unknown'] as const;
export type NginxRunningStatus = (typeof NGINX_RUNNING_STATUSES)[number];

// ─── systemd 服务 ────────────────────────────────────────────────────────────

export const SYSTEMD_ACTIONS = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask'] as const;
export type SystemdAction = (typeof SYSTEMD_ACTIONS)[number];

// ─── 网络诊断 ────────────────────────────────────────────────────────────────

/** 流式诊断类型（输出逐行推送） */
export const NET_DIAG_STREAM_TYPES = ['ping', 'traceroute'] as const;
export type NetDiagStreamType = (typeof NET_DIAG_STREAM_TYPES)[number];

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

// ─── 进程管理 ────────────────────────────────────────────────────────────────

export const PROCESS_KILL_SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'] as const;
export type ProcessKillSignal = (typeof PROCESS_KILL_SIGNALS)[number];

/** Windows 进程优先级类 */
export const PROCESS_PRIORITY_CLASSES = ['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime'] as const;
export type ProcessPriorityClass = (typeof PROCESS_PRIORITY_CLASSES)[number];

// ─── 文件系统（宿主机 / SFTP / 远程主机） ─────────────────────────────────────

export const FS_ENTRY_TYPES = ['dir', 'file'] as const;
export type FsEntryType = (typeof FS_ENTRY_TYPES)[number];

/** 容器内目录项类型（tar 解析可区分符号链接） */
export const DOCKER_FILE_ENTRY_TYPES = ['file', 'dir', 'symlink'] as const;
export type DockerFileEntryType = (typeof DOCKER_FILE_ENTRY_TYPES)[number];

export const FILE_CHECKSUM_ALGOS = ['md5', 'sha1', 'sha256'] as const;
export type FileChecksumAlgo = (typeof FILE_CHECKSUM_ALGOS)[number];

// ─── SSH 配置 ────────────────────────────────────────────────────────────────

/** 个人 SSH 配置的认证方式（key_path / agent 依赖服务器本地文件与 ssh-agent，仅单实例部署可用） */
export const SSH_AUTH_TYPES = ['password', 'key_path', 'key_content', 'agent'] as const;
export type SshAuthType = (typeof SSH_AUTH_TYPES)[number];

// ─── 终端录屏 ────────────────────────────────────────────────────────────────

/** 录屏事件类型：o=输出 i=输入 */
export const TERMINAL_RECORDING_EVENT_TYPES = ['o', 'i'] as const;
export type TerminalRecordingEventType = (typeof TERMINAL_RECORDING_EVENT_TYPES)[number];

/**
 * 终端会话生命周期状态。
 *
 * active 起步即为终态之前的唯一"可写"状态：会话只有在进程创建成功后才登记，
 * 因此不存在 creating 中间态；进程创建失败直接落 failed。
 */
export const TERMINAL_SESSION_STATES = ['active', 'detached', 'terminated', 'failed'] as const;
export type TerminalSessionState = (typeof TERMINAL_SESSION_STATES)[number];

export const TERMINAL_SESSION_STATE_LABELS: Record<TerminalSessionState, string> = {
  active: '连接中',
  detached: '已断开',
  terminated: '已结束',
  failed: '异常终止',
};

/** 终端会话运行目标类型 */
export const TERMINAL_SESSION_KINDS = ['local', 'ssh', 'docker', 'db'] as const;
export type TerminalSessionKind = (typeof TERMINAL_SESSION_KINDS)[number];

export const TERMINAL_SESSION_KIND_LABELS: Record<TerminalSessionKind, string> = {
  local: '本地',
  ssh: 'SSH',
  docker: 'Docker',
  db: '数据库',
};

/** 会话结束原因；落库用于事后追溯"这个会话是怎么没的" */
export const TERMINAL_END_REASONS = [
  'client_closed',
  'process_exited',
  'idle_timeout',
  'terminated_by_admin',
  'server_shutdown',
  'start_failed',
] as const;
export type TerminalEndReason = (typeof TERMINAL_END_REASONS)[number];

export const TERMINAL_END_REASON_LABELS: Record<TerminalEndReason, string> = {
  client_closed: '用户关闭',
  process_exited: '进程退出',
  idle_timeout: '断开超时回收',
  terminated_by_admin: '管理员终止',
  server_shutdown: '服务停机',
  start_failed: '启动失败',
};

// ─── 应用版本管理（在线升级）──────────────────────────────────────────────────

/** 发布渠道 */
export const APP_RELEASE_CHANNELS = ['stable', 'beta', 'internal'] as const;
export type AppReleaseChannel = (typeof APP_RELEASE_CHANNELS)[number];

export const APP_RELEASE_CHANNEL_LABELS: Record<AppReleaseChannel, string> = {
  stable: '正式版',
  beta: '测试版',
  internal: '内部版',
};

export const APP_RELEASE_CHANNEL_OPTIONS: Array<{ value: AppReleaseChannel; label: string }> =
  createLabelOptions(APP_RELEASE_CHANNELS, APP_RELEASE_CHANNEL_LABELS);

/** 版本发布状态机：draft → published → revoked（revoked 可重新 published） */
export const APP_RELEASE_STATUSES = ['draft', 'published', 'revoked'] as const;
export type AppReleaseStatus = (typeof APP_RELEASE_STATUSES)[number];

export const APP_RELEASE_STATUS_LABELS: Record<AppReleaseStatus, string> = {
  draft: '草稿',
  published: '已发布',
  revoked: '已撤回',
};

export const APP_RELEASE_STATUS_OPTIONS: Array<{ value: AppReleaseStatus; label: string }> =
  createLabelOptions(APP_RELEASE_STATUSES, APP_RELEASE_STATUS_LABELS);

/** 客户端平台 */
export const APP_PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios', 'web'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const APP_PLATFORM_LABELS: Record<AppPlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
};

export const APP_PLATFORM_OPTIONS: Array<{ value: AppPlatform; label: string }> =
  createLabelOptions(APP_PLATFORMS, APP_PLATFORM_LABELS);

/** CPU 架构 */
export const APP_ARCHES = ['x64', 'arm64', 'universal'] as const;
export type AppArch = (typeof APP_ARCHES)[number];

export const APP_ARCH_LABELS: Record<AppArch, string> = {
  x64: 'x64',
  arm64: 'ARM64',
  universal: '通用',
};

export const APP_ARCH_OPTIONS: Array<{ value: AppArch; label: string }> =
  createLabelOptions(APP_ARCHES, APP_ARCH_LABELS);

/**
 * 制品类型。
 * installer=完整安装包 hotupdate=Web 资源热更包 metadata=electron-updater
 * 元数据（latest.yml / blockmap）external=外部链接（App Store / TestFlight）
 */
export const APP_ARTIFACT_KINDS = ['installer', 'hotupdate', 'metadata', 'external'] as const;
export type AppArtifactKind = (typeof APP_ARTIFACT_KINDS)[number];

export const APP_ARTIFACT_KIND_LABELS: Record<AppArtifactKind, string> = {
  installer: '安装包',
  hotupdate: '热更新包',
  metadata: '元数据',
  external: '外部链接',
};

export const APP_ARTIFACT_KIND_OPTIONS: Array<{ value: AppArtifactKind; label: string }> =
  createLabelOptions(APP_ARTIFACT_KINDS, APP_ARTIFACT_KIND_LABELS);

/** 走文件上传的制品类型（external 走外链录入，不上传文件） */
export const APP_FILE_ARTIFACT_KINDS = ['installer', 'hotupdate', 'metadata'] as const;
export type AppFileArtifactKind = (typeof APP_FILE_ARTIFACT_KINDS)[number];

/** 升级事件类型（check 由服务端记录，install_* 由客户端回执上报） */
export const APP_RELEASE_EVENT_TYPES = ['check', 'download', 'install_success', 'install_fail'] as const;
export type AppReleaseEventType = (typeof APP_RELEASE_EVENT_TYPES)[number];

export const APP_RELEASE_EVENT_TYPE_LABELS: Record<AppReleaseEventType, string> = {
  check: '检查更新',
  download: '下载',
  install_success: '安装成功',
  install_fail: '安装失败',
};

/** 客户端可主动上报的事件（download 与 check 由服务端记录） */
export const APP_CLIENT_REPORTABLE_EVENT_TYPES = ['install_success', 'install_fail'] as const;
export type AppClientReportableEventType = (typeof APP_CLIENT_REPORTABLE_EVENT_TYPES)[number];

/** semver 校验（允许预发布 / 构建元数据后缀，如 1.2.3-beta.1） */
export const APP_SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

// ─── 运维主机（多主机管理）──────────────────────────────────────────────────────

/**
 * 主机认证方式。平台级共享资源刻意不支持 key_path / agent——
 * 两者依赖服务器本地文件与 ssh-agent 进程状态,在多实例部署下语义不成立。
 */
export const OPS_HOST_AUTH_TYPES = ['password', 'key_content'] as const;
export type OpsHostAuthType = (typeof OPS_HOST_AUTH_TYPES)[number];

export const OPS_HOST_AUTH_TYPE_LABELS: Record<OpsHostAuthType, string> = {
  password: '密码',
  key_content: '私钥内容',
};

/** 主机探测状态:unknown = 尚未探测过 */
export const OPS_HOST_STATUSES = ['unknown', 'online', 'offline'] as const;
export type OpsHostStatus = (typeof OPS_HOST_STATUSES)[number];

export const OPS_HOST_STATUS_LABELS: Record<OpsHostStatus, string> = {
  unknown: '未探测',
  online: '在线',
  offline: '离线',
};

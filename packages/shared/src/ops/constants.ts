/**
 * 运维域枚举常量（pg enum / TS union / 前端展示三端共用）。
 */
import { createLabelOptions } from '../core/enum-options';

/** 应用日志按运行角色分文件，all 表示同一进程同时运行 API 与 Worker。 */
export const CONSOLE_LOG_ROLES = ['all', 'api', 'worker'] as const;
export type ConsoleLogRole = (typeof CONSOLE_LOG_ROLES)[number];
export const CONSOLE_LOG_ROLE_LABELS: Record<ConsoleLogRole, string> = {
  all: 'API + Worker', api: 'API', worker: 'Worker',
};
export const CONSOLE_LOG_ROLE_OPTIONS = createLabelOptions(CONSOLE_LOG_ROLES, CONSOLE_LOG_ROLE_LABELS);

// ─── 维护模式 ────────────────────────────────────────────────────────────────

export const MAINTENANCE_LOG_STATUSES = ['ongoing', 'completed'] as const;
export type MaintenanceLogStatus = (typeof MAINTENANCE_LOG_STATUSES)[number];

// ─── SSL 证书 ────────────────────────────────────────────────────────────────

export const SSL_CERT_TYPES = ['self_signed', 'uploaded', 'letsencrypt'] as const;
export type SslCertType = (typeof SSL_CERT_TYPES)[number];

export const SSL_CERT_TYPE_LABELS: Record<SslCertType, string> = {
  self_signed: '自签名',
  uploaded: '上传',
  letsencrypt: 'Let\'s Encrypt',
};

export const SSL_CERT_TYPE_OPTIONS: Array<{ value: SslCertType; label: string }> =
  createLabelOptions(SSL_CERT_TYPES, SSL_CERT_TYPE_LABELS);

export const SSL_CERT_STATUSES = ['valid', 'expiring', 'expired', 'invalid'] as const;
export type SslCertStatus = (typeof SSL_CERT_STATUSES)[number];

export const SSL_CERT_STATUS_LABELS: Record<SslCertStatus, string> = {
  valid: '有效',
  expiring: '即将过期',
  expired: '已过期',
  invalid: '无效',
};

export const SSL_CERT_STATUS_OPTIONS: Array<{ value: SslCertStatus; label: string }> =
  createLabelOptions(SSL_CERT_STATUSES, SSL_CERT_STATUS_LABELS);

/** 证书下载文件类型：公钥证书 / 私钥 */
export const SSL_CERT_DOWNLOAD_KINDS = ['cert', 'key'] as const;
export type SslCertDownloadKind = (typeof SSL_CERT_DOWNLOAD_KINDS)[number];

// ─── 数据库管理 ──────────────────────────────────────────────────────────────

/** 数据库备份产物类型：pg_dump=完整 SQL（gzip） drizzle_export=逐表 JSON 逻辑导出 */
export const DB_BACKUP_TYPES = ['pg_dump', 'drizzle_export'] as const;
export type DbBackupType = (typeof DB_BACKUP_TYPES)[number];

export const DB_BACKUP_TYPE_LABELS: Record<DbBackupType, string> = {
  pg_dump: 'pg_dump',
  drizzle_export: 'Drizzle 导出',
};

export const DB_BACKUP_TYPE_OPTIONS: Array<{ value: DbBackupType; label: string }> =
  createLabelOptions(DB_BACKUP_TYPES, DB_BACKUP_TYPE_LABELS);

/** 备份任务状态机：pending → running → success / failed */
export const DB_BACKUP_STATUSES = ['pending', 'running', 'success', 'failed'] as const;
export type DbBackupStatus = (typeof DB_BACKUP_STATUSES)[number];

export const DB_BACKUP_STATUS_LABELS: Record<DbBackupStatus, string> = {
  pending: '等待中',
  running: '执行中',
  success: '成功',
  failed: '失败',
};

export const DB_BACKUP_STATUS_OPTIONS: Array<{ value: DbBackupStatus; label: string }> =
  createLabelOptions(DB_BACKUP_STATUSES, DB_BACKUP_STATUS_LABELS);

/** table=普通表 view=视图 matview=物化视图 */
export const DB_ADMIN_TABLE_KINDS = ['table', 'view', 'matview'] as const;
export type DbAdminTableKind = (typeof DB_ADMIN_TABLE_KINDS)[number];

export const DB_ADMIN_MAINTENANCE_ACTIONS = ['vacuum', 'vacuum_analyze', 'analyze', 'reindex'] as const;
export type DbAdminMaintenanceAction = (typeof DB_ADMIN_MAINTENANCE_ACTIONS)[number];

/** 表 SQL 导出范围：ddl=仅结构 data=仅数据 full=结构 + 数据 */
export const DB_ADMIN_SQL_EXPORT_MODES = ['ddl', 'data', 'full'] as const;
export const DB_ADMIN_ORDER_DIRECTIONS = ['asc', 'desc'] as const;
export type DbAdminSqlExportMode = (typeof DB_ADMIN_SQL_EXPORT_MODES)[number];

export const DB_ADMIN_COLUMN_DIFF_ISSUES = ['missing_in_db', 'extra_in_db', 'type_mismatch', 'nullable_mismatch'] as const;
export type DbAdminColumnDiffIssue = (typeof DB_ADMIN_COLUMN_DIFF_ISSUES)[number];

export const DB_ADMIN_COLUMN_DIFF_ISSUE_LABELS: Record<DbAdminColumnDiffIssue, string> = {
  missing_in_db: '列缺失',
  extra_in_db: '多余列',
  type_mismatch: '类型不符',
  nullable_mismatch: '可空性不符',
};

export const DB_ADMIN_COLUMN_DIFF_ISSUE_OPTIONS: Array<{ value: DbAdminColumnDiffIssue; label: string }> =
  createLabelOptions(DB_ADMIN_COLUMN_DIFF_ISSUES, DB_ADMIN_COLUMN_DIFF_ISSUE_LABELS);

export const DB_ADMIN_TABLE_DRIFT_STATUSES = ['missing_in_db', 'extra_in_db', 'column_diff'] as const;
export type DbAdminTableDriftStatus = (typeof DB_ADMIN_TABLE_DRIFT_STATUSES)[number];

export const DB_ADMIN_TABLE_DRIFT_STATUS_LABELS: Record<DbAdminTableDriftStatus, string> = {
  missing_in_db: '表在 DB 中缺失',
  extra_in_db: '表未在 schema.ts 声明',
  column_diff: '列差异',
};

export const DB_ADMIN_TABLE_DRIFT_STATUS_OPTIONS: Array<{ value: DbAdminTableDriftStatus; label: string }> =
  createLabelOptions(DB_ADMIN_TABLE_DRIFT_STATUSES, DB_ADMIN_TABLE_DRIFT_STATUS_LABELS);

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

export const FIREWALL_TYPE_LABELS: Record<FirewallType, string> = {
  ufw: 'UFW',
  firewalld: 'firewalld',
  iptables: 'iptables',
  unknown: '未知',
};

export const FIREWALL_TYPE_OPTIONS: Array<{ value: FirewallType; label: string }> =
  createLabelOptions(FIREWALL_TYPES, FIREWALL_TYPE_LABELS);

export const FIREWALL_RULE_TYPES = ['allow', 'deny', 'reject'] as const;
export type FirewallRuleType = (typeof FIREWALL_RULE_TYPES)[number];

export const FIREWALL_RULE_TYPE_LABELS: Record<FirewallRuleType, string> = {
  allow: '允许',
  deny: '拒绝',
  reject: '拒止',
};

export const FIREWALL_RULE_TYPE_OPTIONS: Array<{ value: FirewallRuleType; label: string }> =
  createLabelOptions(FIREWALL_RULE_TYPES, FIREWALL_RULE_TYPE_LABELS);

export const FIREWALL_PROTOCOLS = ['tcp', 'udp', 'any'] as const;
export type FirewallProtocol = (typeof FIREWALL_PROTOCOLS)[number];

export const FIREWALL_PROTOCOL_LABELS: Record<FirewallProtocol, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  any: 'ANY',
};

export const FIREWALL_PROTOCOL_OPTIONS: Array<{ value: FirewallProtocol; label: string }> =
  createLabelOptions(FIREWALL_PROTOCOLS, FIREWALL_PROTOCOL_LABELS);

export const FIREWALL_DIRECTIONS = ['in', 'out', 'any'] as const;
export type FirewallDirection = (typeof FIREWALL_DIRECTIONS)[number];

export const FIREWALL_DIRECTION_LABELS: Record<FirewallDirection, string> = {
  in: '入站',
  out: '出站',
  any: '任意',
};

export const FIREWALL_DIRECTION_OPTIONS: Array<{ value: FirewallDirection; label: string }> =
  createLabelOptions(FIREWALL_DIRECTIONS, FIREWALL_DIRECTION_LABELS);

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

export const PROCESS_KILL_SIGNAL_LABELS: Record<ProcessKillSignal, string> = {
  SIGTERM: 'SIGTERM（优雅退出，推荐）',
  SIGKILL: 'SIGKILL（强制终止）',
  SIGINT: 'SIGINT（中断）',
  SIGHUP: 'SIGHUP（挂起/重载）',
};

export const PROCESS_KILL_SIGNAL_OPTIONS: Array<{ value: ProcessKillSignal; label: string }> =
  createLabelOptions(PROCESS_KILL_SIGNALS, PROCESS_KILL_SIGNAL_LABELS);

/** Windows 进程优先级类 */
export const PROCESS_PRIORITY_CLASSES = ['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime'] as const;
export type ProcessPriorityClass = (typeof PROCESS_PRIORITY_CLASSES)[number];

export const PROCESS_PRIORITY_CLASS_LABELS: Record<ProcessPriorityClass, string> = {
  Idle: 'Idle（最低）',
  BelowNormal: 'BelowNormal（低于正常）',
  Normal: 'Normal（正常）',
  AboveNormal: 'AboveNormal（高于正常）',
  High: 'High（高）',
  RealTime: 'RealTime（实时，慎用）',
};

export const PROCESS_PRIORITY_CLASS_OPTIONS: Array<{ value: ProcessPriorityClass; label: string }> =
  createLabelOptions(PROCESS_PRIORITY_CLASSES, PROCESS_PRIORITY_CLASS_LABELS);

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

// ─── 应用版本管理（在线升级 / 服务端发布）────────────────────────────────────

/**
 * 应用类型：client = 客户端应用（桌面 / 移动 / Web 热更，设备拉取升级）；
 * service = 服务端应用（部署包推送到运维主机，见「应用部署」）。
 * 两者共用应用 → 版本 → 制品模型与制品上传；渠道 / 灰度 / 强制升级 / 设备统计只对 client 有意义。
 */
export const APP_KINDS = ['client', 'service'] as const;
export type AppKind = (typeof APP_KINDS)[number];

export const APP_KIND_LABELS: Record<AppKind, string> = {
  client: '客户端应用',
  service: '服务端应用',
};

export const APP_KIND_OPTIONS: Array<{ value: AppKind; label: string }> =
  createLabelOptions(APP_KINDS, APP_KIND_LABELS);

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

/** 客户端平台；server = 服务端部署包（应用部署推送到运维主机） */
export const APP_PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios', 'web', 'server'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const APP_PLATFORM_LABELS: Record<AppPlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
  server: '服务端',
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
 * archive=服务端部署包（tar.gz / zip / 单文件 jar 等，由「应用部署」推送到主机）
 */
export const APP_ARTIFACT_KINDS = ['installer', 'hotupdate', 'metadata', 'external', 'archive'] as const;
export type AppArtifactKind = (typeof APP_ARTIFACT_KINDS)[number];

export const APP_ARTIFACT_KIND_LABELS: Record<AppArtifactKind, string> = {
  installer: '安装包',
  hotupdate: '热更新包',
  metadata: '元数据',
  external: '外部链接',
  archive: '部署包',
};

export const APP_ARTIFACT_KIND_OPTIONS: Array<{ value: AppArtifactKind; label: string }> =
  createLabelOptions(APP_ARTIFACT_KINDS, APP_ARTIFACT_KIND_LABELS);

/** 走文件上传的制品类型（external 走外链录入，不上传文件） */
export const APP_FILE_ARTIFACT_KINDS = ['installer', 'hotupdate', 'metadata', 'archive'] as const;
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

// ─── 应用部署（服务端应用推送到运维主机）─────────────────────────────────────

/** 重启方式：systemd 单元 / 自定义脚本（在 current/ 下执行）/ 无需重启（静态资源） */
export const DEPLOY_RESTART_MODES = ['systemd', 'script', 'none'] as const;
export type DeployRestartMode = (typeof DEPLOY_RESTART_MODES)[number];

export const DEPLOY_RESTART_MODE_LABELS: Record<DeployRestartMode, string> = {
  systemd: 'systemd 服务',
  script: '自定义脚本',
  none: '无需重启',
};

export const DEPLOY_RESTART_MODE_OPTIONS: Array<{ value: DeployRestartMode; label: string }> =
  createLabelOptions(DEPLOY_RESTART_MODES, DEPLOY_RESTART_MODE_LABELS);

/** 健康检查方式（在目标主机上执行：http 用 curl、tcp 探端口、command 自定义命令退出码） */
export const DEPLOY_HEALTH_CHECK_TYPES = ['none', 'http', 'tcp', 'command'] as const;
export type DeployHealthCheckType = (typeof DEPLOY_HEALTH_CHECK_TYPES)[number];

export const DEPLOY_HEALTH_CHECK_TYPE_LABELS: Record<DeployHealthCheckType, string> = {
  none: '不检查',
  http: 'HTTP 探活',
  tcp: 'TCP 端口',
  command: '自定义命令',
};

export const DEPLOY_HEALTH_CHECK_TYPE_OPTIONS: Array<{ value: DeployHealthCheckType; label: string }> =
  createLabelOptions(DEPLOY_HEALTH_CHECK_TYPES, DEPLOY_HEALTH_CHECK_TYPE_LABELS);

/** 多主机推进策略：rolling 逐台串行（默认）/ parallel 受 maxParallel 限制的并行 */
export const DEPLOY_STRATEGIES = ['rolling', 'parallel'] as const;
export type DeployStrategy = (typeof DEPLOY_STRATEGIES)[number];

export const DEPLOY_STRATEGY_LABELS: Record<DeployStrategy, string> = {
  rolling: '滚动（逐台）',
  parallel: '并行',
};

export const DEPLOY_STRATEGY_OPTIONS: Array<{ value: DeployStrategy; label: string }> =
  createLabelOptions(DEPLOY_STRATEGIES, DEPLOY_STRATEGY_LABELS);

/** 一次 run 的类型：deploy 部署新版本 / rollback 切回主机上已有的 release / restart 只重启 */
export const DEPLOY_RUN_KINDS = ['deploy', 'rollback', 'restart'] as const;
export type DeployRunKind = (typeof DEPLOY_RUN_KINDS)[number];

export const DEPLOY_RUN_KIND_LABELS: Record<DeployRunKind, string> = {
  deploy: '部署',
  rollback: '回滚',
  restart: '重启',
};

export const DEPLOY_RUN_KIND_OPTIONS: Array<{ value: DeployRunKind; label: string }> =
  createLabelOptions(DEPLOY_RUN_KINDS, DEPLOY_RUN_KIND_LABELS);

/** run 状态：partial = 部分主机失败（含已自动回滚的主机） */
export const DEPLOY_RUN_STATUSES = ['pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled'] as const;
export type DeployRunStatus = (typeof DEPLOY_RUN_STATUSES)[number];

export const DEPLOY_RUN_STATUS_LABELS: Record<DeployRunStatus, string> = {
  pending: '排队中',
  running: '进行中',
  succeeded: '成功',
  partial: '部分失败',
  failed: '失败',
  cancelled: '已取消',
};

export const DEPLOY_RUN_STATUS_OPTIONS: Array<{ value: DeployRunStatus; label: string }> =
  createLabelOptions(DEPLOY_RUN_STATUSES, DEPLOY_RUN_STATUS_LABELS);

export const DEPLOY_RUN_TERMINAL_STATUSES: readonly DeployRunStatus[] = ['succeeded', 'partial', 'failed', 'cancelled'];

export function isDeployRunTerminal(status: DeployRunStatus): boolean {
  return DEPLOY_RUN_TERMINAL_STATUSES.includes(status);
}

/** 单台主机在一次 run 中的状态：rolled_back = 健康检查失败后已自动切回上一版；skipped = 因失败即停未执行 */
export const DEPLOY_HOST_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'rolled_back', 'skipped', 'cancelled'] as const;
export type DeployHostStatus = (typeof DEPLOY_HOST_STATUSES)[number];

export const DEPLOY_HOST_STATUS_LABELS: Record<DeployHostStatus, string> = {
  pending: '等待',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  rolled_back: '已自动回滚',
  skipped: '已跳过',
  cancelled: '已取消',
};

/** 部署流水线步骤（每台主机按序执行；rollback / restart 只走其中一部分） */
export const DEPLOY_STEPS = ['preflight', 'upload', 'unpack', 'before_switch', 'switch', 'restart', 'health_check', 'prune'] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];

export const DEPLOY_STEP_LABELS: Record<DeployStep, string> = {
  preflight: '预检',
  upload: '上传制品',
  unpack: '解包',
  before_switch: '切换前钩子',
  switch: '切换版本',
  restart: '重启',
  health_check: '健康检查',
  prune: '清理旧版本',
};

export const DEPLOY_LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type DeployLogLevel = (typeof DEPLOY_LOG_LEVELS)[number];

/** 主机上 release 目录名：`yyyyMMddHHmmss-<版本>`，同一次 run 在所有主机上同名 */
export const DEPLOY_RELEASE_NAME_RE = /^\d{14}-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** shared/ 下跨版本持久化的相对路径：不含 `..`、不以 / 开头 */
export const DEPLOY_SHARED_PATH_RE = /^(?!\.\.(\/|$))(?!.*\/\.\.(\/|$))[A-Za-z0-9._][A-Za-z0-9._/-]{0,127}$/;

export const DEPLOY_ENV_NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** 部署根目录禁止落在这些系统目录之内（或等于它们） */
export const DEPLOY_FORBIDDEN_ROOTS = ['/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/root', '/run', '/sbin', '/sys', '/usr', '/var/lib', '/var/run'] as const;

// ─── 日志文件打包下载 ────────────────────────────────────────────────────────

/** 同步返回 zip 的文件数上限；超过转任务中心异步打包（与网盘同阈值口径） */
export const LOG_SYNC_ZIP_MAX_FILES = 50;

/** 同步返回 zip 的总字节上限（200MB）；超过转任务中心异步打包 */
export const LOG_SYNC_ZIP_MAX_BYTES = 200 * 1024 * 1024;

/** 日志关联定位的扫描保护：日期仅用于排序，不能绕过总文件 / 字节 / 命中上限。 */
export const LOG_CORRELATION_LOCATOR_MAX_FILES = 200;
export const LOG_CORRELATION_LOCATOR_MAX_BYTES = 256 * 1024 * 1024;
export const LOG_CORRELATION_LOCATOR_MAX_MATCHES = 100;
export const LOG_CORRELATION_LOCATOR_MAX_CONTEXT_LINES = 10;
/** 与控制台日志读取器保持一致；仍是有界读取，避免异常日志占用无限内存。 */
export const LOG_CORRELATION_LOCATOR_MAX_LINE_LENGTH = 8 * 1024 * 1024;

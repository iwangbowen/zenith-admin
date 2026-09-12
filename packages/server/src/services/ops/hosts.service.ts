/**
 * 运维主机管理(多主机基座)
 *
 * ops_hosts 是平台级共享资源(不挂租户),凭据经 secret-crypto 加密落库,
 * 接口只回传有无标识。探测(probe)执行一段常量快照脚本采集时点指标,
 * 供概览矩阵与主机列表直接读缓存,不做时序。
 */
import { desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateOpsHostInput, OpsHost, OpsHostSnapshot, UpdateOpsHostInput } from '@zenith/shared/ops';
import { db } from '../../db';
import { opsHosts } from '../../db/schema';
import type { OpsHostRow } from '../../db/schema';
import { encryptSecret } from '../../lib/secret-crypto';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { requireFirstRow } from '../../lib/db-assert';
import { formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { evictHostConnection, getRemoteExecutor } from '../../lib/host-exec';
import logger from '../../lib/logger';
import { getSshConnectParams, getSshProfile } from './ssh-profiles.service';
import { endSessionsByTarget } from '../../lib/terminal-session-registry';

function mapHost(row: OpsHostRow): OpsHost {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    hasPassword: !!row.passwordEncrypted,
    hasKeyContent: !!row.keyContentEncrypted,
    hasKeyPassphrase: !!row.keyPassphraseEncrypted,
    hostKeyFingerprint: row.hostKeyFingerprint,
    status: row.status,
    snapshot: row.snapshot ?? null,
    probedAt: formatNullableDateTime(row.probedAt),
    probeError: row.probeError,
    enabled: row.enabled,
    remark: row.remark,
    ...formatTimestamps(row),
  };
}

async function ensureHostExists(id: number): Promise<OpsHostRow> {
  return requireFirstRow(
    db.select().from(opsHosts).where(eq(opsHosts.id, id)).limit(1),
    '主机不存在',
  );
}

export async function listOpsHosts(): Promise<OpsHost[]> {
  const rows = await db.select().from(opsHosts).orderBy(desc(opsHosts.createdAt));
  return rows.map(mapHost);
}

export async function getOpsHost(id: number): Promise<OpsHost> {
  return mapHost(await ensureHostExists(id));
}

export async function getOpsHostBeforeAudit(id: number): Promise<OpsHost> {
  return getOpsHost(id);
}

function assertCredentialsComplete(input: CreateOpsHostInput): void {
  if (input.authType === 'password' && !input.password) {
    throw new HTTPException(400, { message: '密码认证方式必须提供密码' });
  }
  if (input.authType === 'key_content' && !input.keyContent) {
    throw new HTTPException(400, { message: '私钥认证方式必须提供私钥内容' });
  }
}

export async function createOpsHost(input: CreateOpsHostInput): Promise<OpsHost> {
  assertCredentialsComplete(input);
  try {
    const [row] = await db.insert(opsHosts).values({
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      passwordEncrypted: input.password ? encryptSecret(input.password) : null,
      keyContentEncrypted: input.keyContent ? encryptSecret(input.keyContent) : null,
      keyPassphraseEncrypted: input.keyPassphrase ? encryptSecret(input.keyPassphrase) : null,
      enabled: input.enabled,
      remark: input.remark ?? null,
    }).returning();
    return mapHost(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '主机名称已存在');
    throw err;
  }
}

/** 将当前用户的 SSH 书签导入为平台级运维主机（凭据重新加密存储）。 */
export async function importOpsHostFromSshProfile(profileId: number, userId: number): Promise<OpsHost> {
  const [profile, params] = await Promise.all([
    getSshProfile(profileId, userId),
    getSshConnectParams(profileId, userId),
  ]);
  if ('agent' in params) {
    throw new HTTPException(400, { message: 'ssh-agent 认证依赖当前进程环境，不能导入平台主机' });
  }
  if ('password' in params) {
    return createOpsHost({
      name: profile.name,
      host: params.host,
      port: params.port,
      username: params.username,
      authType: 'password',
      password: params.password,
      enabled: true,
      remark: `从 SSH 配置「${profile.name}」导入`,
    });
  }
  return createOpsHost({
    name: profile.name,
    host: params.host,
    port: params.port,
    username: params.username,
    authType: 'key_content',
    keyContent: params.privateKey,
    keyPassphrase: params.passphrase,
    enabled: true,
    remark: `从 SSH 配置「${profile.name}」导入`,
  });
}

export async function updateOpsHost(id: number, input: UpdateOpsHostInput): Promise<OpsHost> {
  const existing = await ensureHostExists(id);
  const targetAuthType = input.authType ?? existing.authType;
  const effectivePassword = input.password === undefined ? existing.passwordEncrypted : input.password;
  const effectivePrivateKey = input.keyContent === undefined ? existing.keyContentEncrypted : input.keyContent;
  if (targetAuthType === 'password' && !effectivePassword) {
    throw new HTTPException(400, { message: '密码认证方式必须保留有效密码' });
  }
  if (targetAuthType === 'key_content' && !effectivePrivateKey) {
    throw new HTTPException(400, { message: '私钥认证方式必须保留有效私钥' });
  }
  const patch: Partial<typeof opsHosts.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.host !== undefined) patch.host = input.host;
  if (input.port !== undefined) patch.port = input.port;
  if (
    (input.host !== undefined && input.host !== existing.host)
    || (input.port !== undefined && input.port !== existing.port)
  ) {
    // 连接端点已变更：旧指纹属于另一端点，必须重新走 TOFU；旧快照也不能继续展示。
    patch.hostKeyFingerprint = null;
    patch.status = 'unknown';
    patch.snapshot = null;
    patch.probedAt = null;
    patch.probeError = null;
  }
  if (input.username !== undefined) patch.username = input.username;
  if (input.authType !== undefined) {
    patch.authType = input.authType;
    // 最小化凭据留存：认证方式切换时清除不再使用的另一类密钥材料
    if (input.authType === 'password') {
      patch.keyContentEncrypted = null;
      patch.keyPassphraseEncrypted = null;
    } else {
      patch.passwordEncrypted = null;
    }
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.remark !== undefined) patch.remark = input.remark || null;
  // 凭据字段:undefined = 不修改;空串 = 清除;非空 = 加密更新
  if (input.password !== undefined) patch.passwordEncrypted = input.password ? encryptSecret(input.password) : null;
  if (input.keyContent !== undefined) patch.keyContentEncrypted = input.keyContent ? encryptSecret(input.keyContent) : null;
  if (input.keyPassphrase !== undefined) patch.keyPassphraseEncrypted = input.keyPassphrase ? encryptSecret(input.keyPassphrase) : null;
  const connectionChanged = input.host !== undefined
    || input.port !== undefined
    || input.username !== undefined
    || input.authType !== undefined
    || input.password !== undefined
    || input.keyContent !== undefined
    || input.keyPassphrase !== undefined
    || input.enabled === false;
  if (connectionChanged) patch.connectionVersion = existing.connectionVersion + 1;
  // 连接地址 / 凭据变更后旧连接必须失效
  try {
    const [row] = await db.update(opsHosts).set(patch).where(eq(opsHosts.id, id)).returning();
    if (connectionChanged) {
      evictHostConnection(id);
      endSessionsByTarget(`host:${id}`, 'terminated_by_admin');
    }
    return mapHost(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '主机名称已存在');
    throw err;
  }
}

export async function deleteOpsHost(id: number): Promise<void> {
  await ensureHostExists(id);
  evictHostConnection(id);
  endSessionsByTarget(`host:${id}`, 'terminated_by_admin');
  await db.delete(opsHosts).where(eq(opsHosts.id, id));
}

/** 主机重装等场景导致指纹变化:管理员确认无风险后显式重置,下次连接重新 TOFU */
export async function resetOpsHostKey(id: number): Promise<void> {
  const existing = await ensureHostExists(id);
  evictHostConnection(id);
  endSessionsByTarget(`host:${id}`, 'terminated_by_admin');
  await db.update(opsHosts).set({
    hostKeyFingerprint: null,
    connectionVersion: existing.connectionVersion + 1,
    status: 'unknown',
    snapshot: null,
    probedAt: null,
    probeError: null,
  }).where(eq(opsHosts.id, id));
}

// ─── 探测 ─────────────────────────────────────────────────────────────────────

/**
 * 快照脚本:常量字面量(经 sh -c 执行,不含任何外部输入)。
 * 以 @@ 分节标记输出,单次往返采集全部指标。
 */
const SNAPSHOT_SCRIPT = [
  'echo "@@KERNEL"; uname -sr 2>/dev/null',
  'echo "@@OS"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")',
  'echo "@@UPTIME"; cat /proc/uptime 2>/dev/null',
  'echo "@@CPU"; nproc 2>/dev/null',
  'echo "@@LOAD"; cat /proc/loadavg 2>/dev/null',
  'echo "@@MEM"; free -b 2>/dev/null | sed -n 2p',
  'echo "@@DISK"; df -B1 -P / 2>/dev/null | sed -n 2p',
].join('; ');

/** 解析快照脚本输出;导出仅为单测 */
export function parseSnapshotOutput(output: string): OpsHostSnapshot {
  const sections = new Map<string, string>();
  let current: string | null = null;
  for (const line of output.split('\n')) {
    const marker = line.trim().match(/^@@(\w+)$/);
    if (marker) {
      current = marker[1];
      sections.set(current, '');
      continue;
    }
    if (current) sections.set(current, `${sections.get(current)}${line}\n`);
  }
  const text = (key: string) => sections.get(key)?.trim() || null;

  const uptime = text('UPTIME');
  const load = text('LOAD');
  const mem = text('MEM')?.split(/\s+/) ?? [];
  const disk = text('DISK')?.split(/\s+/) ?? [];
  const memTotal = Number(mem[1]) || null;
  const memUsed = Number(mem[2]) || null;
  const diskTotal = Number(disk[1]) || null;
  const diskUsed = Number(disk[2]) || null;

  return {
    kernel: text('KERNEL'),
    osName: text('OS'),
    uptimeSeconds: uptime ? Math.floor(Number(uptime.split(/\s+/)[0])) || null : null,
    cpuCores: Number(text('CPU')) || null,
    load1: load ? Number(load.split(/\s+/)[0]) || null : null,
    memTotalBytes: memTotal,
    memUsedBytes: memUsed,
    memUsagePercent: memTotal && memUsed ? Math.round((memUsed / memTotal) * 100) : null,
    diskTotalBytes: diskTotal,
    diskUsedBytes: diskUsed,
    diskUsagePercent: diskTotal && diskUsed ? Math.round((diskUsed / diskTotal) * 100) : null,
  };
}

export interface OpsHostTestResult {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

/** 测试连接:建连 + 执行 echo,返回时延;不落库 */
export async function testOpsHostConnection(id: number): Promise<OpsHostTestResult> {
  const start = Date.now();
  try {
    const executor = await getRemoteExecutor(id);
    await executor.exec('echo', ['ok'], { timeoutMs: 10_000 });
    return { ok: true, message: '连接成功', latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs: null };
  }
}

/** 探测单台主机并回写状态与快照 */
export async function probeOpsHost(id: number): Promise<OpsHost> {
  const row = await ensureHostExists(id);
  if (!row.enabled) throw new HTTPException(400, { message: `主机「${row.name}」已停用` });
  try {
    const executor = await getRemoteExecutor(id);
    const { stdout } = await executor.exec('sh', ['-c', SNAPSHOT_SCRIPT], { timeoutMs: 15_000 });
    const snapshot = parseSnapshotOutput(stdout);
    const [updated] = await db.update(opsHosts).set({
      status: 'online',
      snapshot,
      probedAt: new Date(),
      probeError: null,
    }).where(eq(opsHosts.id, id)).returning();
    return mapHost(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [updated] = await db.update(opsHosts).set({
      status: 'offline',
      probedAt: new Date(),
      probeError: message.slice(0, 500),
    }).where(eq(opsHosts.id, id)).returning();
    return mapHost(updated);
  }
}

/** 探测全部启用主机(cron 入口);并发 5,单台失败不影响其他 */
export async function probeAllOpsHosts(): Promise<{ total: number; online: number; offline: number }> {
  const rows = await db.select({ id: opsHosts.id }).from(opsHosts).where(eq(opsHosts.enabled, true));
  let online = 0;
  let offline = 0;
  const queue = [...rows];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const result = await probeOpsHost(item.id);
        if (result.status === 'online') online += 1; else offline += 1;
      } catch (err) {
        offline += 1;
        logger.warn({ err, hostId: item.id }, '[ops-hosts] 主机探测异常');
      }
    }
  });
  await Promise.all(workers);
  return { total: rows.length, online, offline };
}

/**
 * 进程崩溃哨兵补投：启动时扫描 lib/fatal-handlers 写下的崩溃哨兵，
 * 结构化记入主日志（计入 logErrorPerMin 告警指标），经通知中心告知平台超管，
 * 并把处理完的哨兵归档到 crashes/archived/。
 *
 * 为什么在下一次启动补投而不是崩溃当时直发：垂死进程里 DB / 通知链路本身可能
 * 就是故障源，异步 I/O 不可靠；健康的新进程 + 事务性 outbox 才是可靠发件人。
 * 与终端会话 reconcile、analytics rollup catch-up 同属 reconcile-on-startup 模式。
 *
 * 失败语义：notify 失败保留哨兵文件、下次启动重试；解析失败（malformed）直接归档
 * 避免每次启动重复失败；本函数吞掉一切异常，绝不阻断服务启动。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatDateTime } from '../../lib/datetime';
import { crashSentinelDir, type CrashRecord } from '../../lib/fatal-handlers';
import logger from '../../lib/logger';
import { notify } from '../messaging/notification-outbox.service';
import { listEnabledPlatformSuperAdmins } from '../identity/platform-admins.service';

/**
 * 单次启动最多补投通知的哨兵数量：崩溃循环场景下最新 N 条已足够说明问题，
 * 更早的只留日志、直接归档，避免通知风暴与启动开销
 */
const MAX_NOTIFY_PER_STARTUP = 20;

function formatCrashedAt(iso: string | undefined): string {
  if (!iso) return '未知时间';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDateTime(date);
}

async function archiveSentinel(dir: string, archiveDir: string, name: string): Promise<void> {
  try {
    await fs.rename(path.join(dir, name), path.join(archiveDir, name));
  } catch (err) {
    logger.warn('[crash-report] 崩溃哨兵归档失败，保留原文件', { file: name, err });
  }
}

export async function replayCrashSentinelsOnStartup(): Promise<void> {
  try {
    const dir = crashSentinelDir();
    let names: string[];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.startsWith('crash-') && n.endsWith('.json'));
    } catch {
      return; // 目录不存在 = 从未崩溃过
    }
    if (names.length === 0) return;
    // crash-{epochMs}-{pid}.json：epoch 毫秒定长，字典序即时间序
    names.sort();
    const archiveDir = path.join(dir, 'archived');
    await fs.mkdir(archiveDir, { recursive: true });

    const adminIds = (await listEnabledPlatformSuperAdmins()).map((admin) => admin.id);
    const recipients = adminIds.map((id) => ({ type: 'user' as const, id }));
    if (recipients.length === 0) {
      logger.warn('[crash-report] 未找到可通知的平台超管，崩溃记录仅落日志');
    }
    // 仅最新 N 条发通知；更早的（notifyFrom 之前）只留日志后归档
    const notifyFrom = Math.max(0, names.length - MAX_NOTIFY_PER_STARTUP);

    for (const [index, name] of names.entries()) {
      let record: Partial<CrashRecord>;
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
        record = parsed as Partial<CrashRecord>;
      } catch (err) {
        logger.warn('[crash-report] 崩溃哨兵解析失败，直接归档', { file: name, err });
        await archiveSentinel(dir, archiveDir, name);
        continue;
      }

      // 结构化留痕：进主日志（ops 日志查看器可检索，并计入 logErrorPerMin 指标）
      logger.error('[crash-report] 检测到上一次进程异常崩溃', { sentinel: name, ...record });

      if (recipients.length > 0 && index >= notifyFrom) {
        try {
          await notify('ops.server.crashed', {
            recipients,
            vars: {
              kind: record.kind ?? 'unknown',
              message: (record.message ?? '未知错误').slice(0, 300),
              crashedAt: formatCrashedAt(record.crashedAt),
              pid: record.pid ?? 0,
              uptimeSec: record.uptimeSec ?? 0,
            },
            tenantId: null,
            link: '/system/log-viewer',
            dedupeKey: `server-crash:${name}`,
          });
        } catch (err) {
          logger.error('[crash-report] 崩溃告警补投失败，保留哨兵下次启动重试', { file: name, err });
          continue; // 不归档
        }
      }
      await archiveSentinel(dir, archiveDir, name);
    }

    if (notifyFrom > 0) {
      logger.warn(`[crash-report] 崩溃哨兵共 ${names.length} 条，仅最新 ${MAX_NOTIFY_PER_STARTUP} 条发送通知，其余已归档`);
    }
  } catch (err) {
    logger.error('[crash-report] 崩溃哨兵补投异常（不影响启动）', err);
  }
}

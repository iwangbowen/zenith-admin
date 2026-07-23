/**
 * CMS 主题代码变更零维护自动检测。
 *
 * 主题模板编译进服务端代码，发版后已生成的静态页仍是旧样式且不会自我更新
 * （hybrid 仅在 miss 时回写，已存在文件永不刷新）。本模块在服务启动时对
 * cms/themes 目录做内容指纹（SHA-256），与 system_configs 中记录的上次指纹
 * 对比：变化的主题 → 自动提交「CMS 主题变更重建」任务重建其下全部非 dynamic
 * 站点。开发者无需维护版本号，改完主题代码发版即自动生效。
 *
 * 指纹粒度：themes 根目录直属文件（types/registry/blocks 等共享代码）计入
 * 所有主题；themes/{code}/ 子目录只计入对应主题。
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { and, eq, isNull, inArray, ne } from 'drizzle-orm';
import { db } from '../../db';
import { cmsSites, systemConfigs } from '../../db/schema';
import { listThemes } from '../../cms/themes/registry';
import { submitCmsPublishTask } from './cms-publishing.service';
import { runWithCurrentUser } from '../../lib/context';
import redis from '../../lib/redis';
import { config } from '../../config';
import logger from '../../lib/logger';

const CONFIG_KEY = 'cms:theme:fingerprints';
const LOCK_KEY = `${config.redis.keyPrefix}cms:theme-rebuild-lock`;
const LOCK_TTL_SECONDS = 300;

/** themes 目录运行时路径（dev = src/cms/themes，prod = dist/cms/themes，与当前文件相对位置一致） */
const THEMES_DIR = fileURLToPath(new URL('../../cms/themes/', import.meta.url));

async function hashFiles(hash: ReturnType<typeof createHash>, dir: string): Promise<void> {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await hashFiles(hash, full);
    } else if (entry.isFile()) {
      hash.update(entry.name);
      hash.update(await readFile(full));
    }
  }
}

/** 计算各注册主题的内容指纹：sha256(共享根文件 + 主题子目录) */
export async function computeThemeFingerprints(): Promise<Record<string, string>> {
  // 共享根文件（types.ts / registry.ts / blocks.tsx…）：单独摘要后并入每个主题
  const sharedHash = createHash('sha256');
  const rootEntries = (await readdir(THEMES_DIR, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of rootEntries) {
    if (entry.isFile()) {
      sharedHash.update(entry.name);
      sharedHash.update(await readFile(path.join(THEMES_DIR, entry.name)));
    }
  }
  const sharedDigest = sharedHash.digest('hex');

  const result: Record<string, string> = {};
  for (const { code } of listThemes()) {
    const hash = createHash('sha256');
    hash.update(sharedDigest);
    await hashFiles(hash, path.join(THEMES_DIR, code));
    result[code] = hash.digest('hex');
  }
  return result;
}

async function readStoredFingerprints(): Promise<Record<string, string> | null> {
  const [row] = await db.select({ value: systemConfigs.configValue }).from(systemConfigs)
    .where(and(eq(systemConfigs.configKey, CONFIG_KEY), isNull(systemConfigs.tenantId)))
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : null;
  } catch {
    return null;
  }
}

async function saveFingerprints(fingerprints: Record<string, string>): Promise<void> {
  const value = JSON.stringify(fingerprints);
  const updated = await db.update(systemConfigs)
    .set({ configValue: value })
    .where(and(eq(systemConfigs.configKey, CONFIG_KEY), isNull(systemConfigs.tenantId)))
    .returning({ id: systemConfigs.id });
  if (updated.length === 0) {
    await db.insert(systemConfigs).values({
      configKey: CONFIG_KEY,
      configValue: value,
      configType: 'json',
      description: 'CMS 主题代码指纹（启动自动检测，变更触发静态页重建；系统维护，勿手改）',
    });
  }
}

/** 以系统管理员身份执行（启动流程无请求上下文；admin id=1 由 seed 保证存在） */
async function runAsSystemAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return runWithCurrentUser({ userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null }, fn);
}

/**
 * 启动检测：主题指纹变化 → 自动提交受影响站点的静态页重建任务。
 * - 首次运行只登记指纹，不触发重建（避免存量部署升级时全站群突然重建）
 * - Redis NX 锁防多实例重复提交；任务本身带幂等键兜底
 * - 任何失败仅记日志，不阻塞启动（下次启动重试）
 */
export async function checkThemeChangesAndRebuild(): Promise<void> {
  try {
    const current = await computeThemeFingerprints();
    const stored = await readStoredFingerprints();

    if (!stored) {
      await saveFingerprints(current);
      logger.info('[cms-theme-watch] 首次登记主题指纹，不触发重建');
      return;
    }

    const changed = Object.keys(current).filter((code) => stored[code] !== current[code]);
    if (changed.length === 0) {
      logger.info('[cms-theme-watch] 主题指纹无变化');
      return;
    }

    const locked = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!locked) {
      logger.info('[cms-theme-watch] 其他实例正在处理主题变更重建，跳过');
      return;
    }

    const sites = await db.select({ id: cmsSites.id, name: cmsSites.name, theme: cmsSites.theme })
      .from(cmsSites)
      .where(and(
        inArray(cmsSites.theme, changed),
        ne(cmsSites.staticMode, 'dynamic'),
        eq(cmsSites.status, 'enabled'),
      ));

    if (sites.length === 0) {
      await saveFingerprints(current);
      logger.info(`[cms-theme-watch] 主题 [${changed.join(', ')}] 已变更，但无受影响的静态化站点`);
      return;
    }

    // 幂等键含指纹摘要：多实例竞态或指纹保存失败后的重启不会重复建任务
    const fpDigest = createHash('sha256').update(changed.map((c) => `${c}:${current[c]}`).join('|')).digest('hex').slice(0, 32);
    await runAsSystemAdmin(async () => {
      for (const site of sites) {
        await submitCmsPublishTask({
          siteId: site.id,
          targetType: 'theme',
          themeCode: site.theme,
          reason: `内置主题代码变更：${changed.join('、')}`,
        }, {
          skipPermissionCheck: true,
          skipAccessCheck: true,
          eventKey: `theme-watch:${fpDigest}:${site.id}`,
        });
      }
    });
    await saveFingerprints(current);
    logger.warn(`[cms-theme-watch] 检测到主题 [${changed.join(', ')}] 代码变更，已提交 ${sites.length} 个站点的静态页重建任务：${sites.map((s) => s.name).join('、')}`);
  } catch (err) {
    logger.error('[cms-theme-watch] 主题变更检测失败（不影响启动）', err);
  }
}

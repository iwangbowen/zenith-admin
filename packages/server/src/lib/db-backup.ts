import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { dbBackups, managedFiles, fileStorageConfigs } from '../db/schema';
import { config } from '../config';
import { uploadFileByConfig } from './file-storage';
import logger from './logger';
import { formatFileTimestamp } from './datetime';

const execAsync = promisify(exec);

const BACKUP_DIR = path.resolve(process.cwd(), 'storage/backups');

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

async function getDefaultStorageConfig() {
  const [cfg] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.isDefault, true))
    .limit(1);
  return cfg || null;
}

/** 上传备份文件到默认存储并登记 managed_files，返回 fileId（无默认存储时返回 null） */
async function uploadBackupToStorage(filePath: string, filename: string, mimeType: string): Promise<string | null> {
  const storageCfg = await getDefaultStorageConfig();
  if (!storageCfg) return null;
  const fileBuffer = await fs.readFile(filePath);
  const file = new File([fileBuffer], filename, { type: mimeType });
  const uploaded = await uploadFileByConfig(storageCfg, file);
  const [managedFile] = await db
    .insert(managedFiles)
    .values({
      storageConfigId: storageCfg.id,
      storageName: storageCfg.name,
      provider: storageCfg.provider,
      originalName: filename,
      objectKey: uploaded.objectKey,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      extension: uploaded.extension,
    })
    .returning();
  return managedFile.id;
}

/** 备份任务统一执行器：置 running → 生成备份文件 → 上传登记 → 置 success/failed 并记录耗时 */
async function runBackupJob(
  backupId: number,
  label: string,
  produce: () => Promise<{ filename: string; filePath: string; mimeType: string }>,
): Promise<void> {
  const startedAt = new Date();
  await db.update(dbBackups).set({ status: 'running', startedAt }).where(eq(dbBackups.id, backupId));

  try {
    await ensureBackupDir();
    const { filename, filePath, mimeType } = await produce();
    const stat = await fs.stat(filePath);
    const fileId = await uploadBackupToStorage(filePath, filename, mimeType);

    const completedAt = new Date();
    await db
      .update(dbBackups)
      .set({
        status: 'success',
        fileId,
        fileSize: stat.size,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      })
      .where(eq(dbBackups.id, backupId));

    logger.info(`${label}完成: ${filename} (${stat.size} bytes)`);
  } catch (err: unknown) {
    const completedAt = new Date();
    await db
      .update(dbBackups)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      })
      .where(eq(dbBackups.id, backupId));
    logger.error(`${label}失败`, err);
    throw err;
  }
}

export async function createPgDumpBackup(backupId: number): Promise<void> {
  await runBackupJob(backupId, 'pg_dump 备份', async () => {
    const timestamp = formatFileTimestamp();
    const filename = `pgdump-${timestamp}.sql.gz`;
    const filePath = path.join(BACKUP_DIR, filename);

    // 使用 pg_dump 导出并 gzip 压缩
    const dbUrl = config.databaseUrl;
    await execAsync(`pg_dump "${dbUrl}" | gzip > "${filePath}"`);
    return { filename, filePath, mimeType: 'application/gzip' };
  });
}

export async function createDrizzleExportBackup(backupId: number, tables?: string): Promise<void> {
  await runBackupJob(backupId, 'Drizzle 逻辑导出', async () => {
    const timestamp = formatFileTimestamp();
    const filename = `drizzle-export-${timestamp}.json`;
    const filePath = path.join(BACKUP_DIR, filename);

    // 导出所有表数据为 JSON
    const { sql } = await import('drizzle-orm');
    const tableList = tables ? tables.split(',').map((t) => t.trim()) : null;

    // 获取所有表名
    const allTables = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );

    const exportData: Record<string, unknown[]> = {};
    for (const row of allTables as unknown as Array<{ table_name: string }>) {
      const tableName = row.table_name;
      if (tableList && !tableList.includes(tableName)) continue;
      if (tableName === 'drizzle_migrations' || tableName === '__drizzle_migrations') continue;
      const data = await db.execute(sql.raw(`SELECT * FROM "${tableName}"`));
      exportData[tableName] = [...data] as unknown[];
    }

    const content = JSON.stringify(exportData, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
    return { filename, filePath, mimeType: 'application/json' };
  });
}

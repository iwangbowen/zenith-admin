import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { dbBackups, managedFiles, fileStorageConfigs } from '../db/schema';
import { config } from '../config';
import { uploadFileByConfig } from './file-storage';
import logger from './logger';

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

export async function createPgDumpBackup(backupId: number): Promise<void> {
  const startedAt = new Date();
  await db.update(dbBackups).set({ status: 'running', startedAt }).where(eq(dbBackups.id, backupId));

  try {
    await ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pgdump-${timestamp}.sql.gz`;
    const filePath = path.join(BACKUP_DIR, filename);

    // 使用 pg_dump 导出并 gzip 压缩
    const dbUrl = config.databaseUrl;
    await execAsync(`pg_dump "${dbUrl}" | gzip > "${filePath}"`);

    const stat = await fs.stat(filePath);

    // 上传到文件存储
    const storageCfg = await getDefaultStorageConfig();
    let fileId: number | null = null;

    if (storageCfg) {
      const fileBuffer = await fs.readFile(filePath);
      const file = new File([fileBuffer], filename, { type: 'application/gzip' });
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
      fileId = managedFile.id;
    }

    // 清理本地临时文件（已上传后）
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

    logger.info(`pg_dump 备份完成: ${filename} (${stat.size} bytes)`);
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
    logger.error('pg_dump 备份失败', err);
    throw err;
  }
}

export async function createDrizzleExportBackup(backupId: number, tables?: string): Promise<void> {
  const startedAt = new Date();
  await db.update(dbBackups).set({ status: 'running', startedAt }).where(eq(dbBackups.id, backupId));

  try {
    await ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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

    const stat = await fs.stat(filePath);
    const storageCfg = await getDefaultStorageConfig();
    let fileId: number | null = null;

    if (storageCfg) {
      const fileBuffer = await fs.readFile(filePath);
      const file = new File([fileBuffer], filename, { type: 'application/json' });
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
      fileId = managedFile.id;
    }

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

    logger.info(`Drizzle 逻辑导出完成: ${filename} (${stat.size} bytes)`);
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
    logger.error('Drizzle 逻辑导出失败', err);
    throw err;
  }
}

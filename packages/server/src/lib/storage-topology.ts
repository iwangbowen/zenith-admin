/**
 * worker 角色的存储拓扑自检。
 *
 * 本地磁盘型存储把文件落在进程所在主机：`local` 的文件本体、`local` / `kodo` / `sftp` 的分片暂存目录、
 * 非纯动态 CMS 站点的静态化产物。api 与 worker 拆到不同主机后，worker 生成的导出文件 / 静态页 / 备份
 * 会落在 worker 的磁盘上而 api 读不到——这类错误在运行期只表现为「文件不存在」，很难定位。
 * 因此纯 worker 进程启动时校验：命中本地磁盘型存储却未声明 STORAGE_SHARED=true（各进程共享卷）就拒绝启动。
 * 同时承担 api 角色的进程（单机全量）天然同盘，不检查。
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db';
import { cmsSites, fileStorageConfigs } from '../db/schema';

/** 依赖进程本地磁盘的存储驱动：local 存文件本体；kodo / sftp 无云端 multipart，分片先落本地再合并 */
export const LOCAL_DISK_STORAGE_PROVIDERS = ['local', 'kodo', 'sftp'] as const;

export interface StorageTopologyIssue {
  kind: 'file-storage' | 'cms-static';
  detail: string;
}

/** 收集需要共享卷的本地磁盘依赖；返回空数组表示无需共享卷 */
export async function collectLocalDiskDependencies(): Promise<StorageTopologyIssue[]> {
  const issues: StorageTopologyIssue[] = [];
  const storages = await db.select({ name: fileStorageConfigs.name, provider: fileStorageConfigs.provider })
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.status, 'enabled'), inArray(fileStorageConfigs.provider, [...LOCAL_DISK_STORAGE_PROVIDERS])));
  for (const storage of storages) {
    issues.push({ kind: 'file-storage', detail: `存储配置「${storage.name}」（${storage.provider}）依赖本地磁盘` });
  }
  const staticSites = await db.$count(cmsSites, ne(cmsSites.staticMode, 'dynamic'));
  if (staticSites > 0) {
    issues.push({ kind: 'cms-static', detail: `${staticSites} 个 CMS 站点启用了静态化，产物写入 CMS_STATIC_ROOT` });
  }
  return issues;
}

/**
 * 纯 worker 角色启动前调用：命中本地磁盘依赖且未声明共享卷时抛错（由入口终止进程）。
 * 查询失败不阻断启动——数据库不可用会由后续步骤以更明确的错误暴露。
 */
export async function assertWorkerStorageTopology(): Promise<void> {
  if (config.roles.api || !config.roles.worker || config.storageShared) return;
  let issues: StorageTopologyIssue[];
  try {
    issues = await collectLocalDiskDependencies();
  } catch {
    return;
  }
  if (issues.length === 0) return;
  throw new Error(
    'worker 角色依赖本地磁盘型存储，但未声明各进程共享该磁盘（STORAGE_SHARED=true）：\n'
    + issues.map((issue) => `  - ${issue.detail}`).join('\n')
    + '\n请把 storage/（或 localRootPath / UPLOAD_TEMP_DIR / CMS_STATIC_ROOT）挂为 api 与 worker 共享的卷后设置 STORAGE_SHARED=true，'
    + '或改用对象存储（oss / s3 / cos / obs / azure / bos）。见 docs/guide/deployment.md「多实例与本地存储」。',
  );
}

import { eq, and, inArray, asc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { businessFiles, managedFiles } from '../db/schema';
import type { DbExecutor } from '../db/types';
import { formatDateTime } from '../lib/datetime';
import { buildManagedFileUrl } from '../lib/file-storage';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

import type { BusinessFileRow } from '../db/schema';

export type BusinessFileType = BusinessFileRow['businessType'];

/**
 * 查询某个业务记录的所有附件
 */
export async function listBusinessFiles(businessType: BusinessFileType, businessId: number) {
  const user = currentUser();
  const rows = await db
    .select()
    .from(businessFiles)
    .leftJoin(managedFiles, eq(businessFiles.fileId, managedFiles.id))
    .where(
      and(
        eq(businessFiles.businessType, businessType),
        eq(businessFiles.businessId, businessId),
        tenantCondition(businessFiles, user),
      ),
    )
    .orderBy(asc(businessFiles.sortOrder), asc(businessFiles.id));

  const validRows = rows.filter((r): r is typeof r & { managed_files: NonNullable<typeof r.managed_files> } => r.managed_files !== null);
  return validRows.map((r) => {
      const file = r.managed_files;
      return {
        id: r.business_files.id,
        businessType: r.business_files.businessType,
        businessId: r.business_files.businessId,
        fileId: r.business_files.fileId,
        name: r.business_files.name ?? null,
        category: r.business_files.category ?? null,
        sortOrder: r.business_files.sortOrder ?? 0,
        file: {
          id: file.id,
          originalName: file.originalName,
          size: file.size,
          mimeType: file.mimeType ?? null,
          extension: file.extension ?? null,
          url: buildManagedFileUrl(file.id),
        },
        createdAt: formatDateTime(r.business_files.createdAt),
      };
    });
}

/**
 * 批量保存附件（先删后插，在事务中调用）
 */
export async function saveBusinessFiles(
  executor: DbExecutor,
  businessType: BusinessFileType,
  businessId: number,
  fileIds: number[],
  categories?: Record<number, string | null>,
) {
  const user = currentUser();
  // 删除旧关联
  await executor
    .delete(businessFiles)
    .where(
      and(
        eq(businessFiles.businessType, businessType),
        eq(businessFiles.businessId, businessId),
        tenantCondition(businessFiles, user),
      ),
    );

  if (fileIds.length === 0) return;

  // 校验文件存在且属于当前租户
  const files = await executor
    .select()
    .from(managedFiles)
    .where(
      and(
        inArray(managedFiles.id, fileIds),
        tenantCondition(managedFiles, user),
      ),
    );

  if (files.length !== fileIds.length) {
    throw new HTTPException(400, { message: '部分文件不存在或无权关联' });
  }

  // 插入新关联
  await executor.insert(businessFiles).values(
    fileIds.map((fileId, index) => ({
      businessType,
      businessId,
      fileId,
      category: categories?.[fileId] ?? null,
      sortOrder: index,
      tenantId: getCreateTenantId(user),
    })),
  );
}

/**
 * 移除单个附件关联
 */
export async function removeBusinessFile(businessType: BusinessFileType, businessId: number, fileId: number) {
  const user = currentUser();
  const result = await db
    .delete(businessFiles)
    .where(
      and(
        eq(businessFiles.businessType, businessType),
        eq(businessFiles.businessId, businessId),
        eq(businessFiles.fileId, fileId),
        tenantCondition(businessFiles, user),
      ),
    );
  return result;
}

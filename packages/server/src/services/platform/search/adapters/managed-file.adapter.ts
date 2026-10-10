import { desc, eq } from 'drizzle-orm';
import { formatBytes } from '@zenith/shared/core';
import { hasPermission, currentUser } from '../../../../lib/context';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere, keywordCondition } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { managedFiles } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const managedFileSearchAdapter: GlobalSearchAdapter = {
  type: 'managed-file',
  permissions: ['system:file:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('system:file:list'))) return [];
    const user = currentUser();
    const rows = await db.select({
      id: managedFiles.id,
      originalName: managedFiles.originalName,
      storageName: managedFiles.storageName,
      mimeType: managedFiles.mimeType,
      extension: managedFiles.extension,
      size: managedFiles.size,
    })
      .from(managedFiles)
      .where(buildWhere(
        // 与文件列表页同口径：文件名 / 对象键 / 文件服务
        keywordCondition(q, [managedFiles.originalName, managedFiles.objectKey, managedFiles.storageName]),
        eq(managedFiles.visibility, 'public'),
        tenantCondition(managedFiles, user),
      ))
      .orderBy(desc(managedFiles.createdAt))
      .limit(limit);
    return rows.map((row) => result({
      type: 'managed-file',
      id: row.id,
      title: row.originalName,
      subtitle: [row.storageName, formatBytes(row.size)].filter(Boolean).join(' · '),
      description: [row.extension ? `.${row.extension}` : null, row.mimeType].filter(Boolean).join(' · '),
      icon: row.mimeType?.startsWith('image/') ? 'Image' : 'FileText',
      route: `/system/files?keyword=${encodeURIComponent(row.originalName)}`,
      highlights: [{ field: 'title', text: row.originalName }],
    }));
  },
};

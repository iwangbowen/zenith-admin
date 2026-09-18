import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_RECON_MAX_FILE_BYTES } from '@zenith/shared/payment';
import { db } from '../../db';
import { fileStorageConfigs, paymentStatements, paymentStatementFiles, paymentStatementPeriods, type PaymentStatementPeriodRow, type PaymentStatementFileRow, type FileStorageConfigRow } from '../../db/schema';
import { uploadObjectByConfig, readStoredFile, extractBucketName } from '../../lib/file-storage';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import type { ProviderBillArtifact } from '../../lib/payment/bill-types';

export function statementArtifact(bytes: Buffer, filename: string, mimeType = 'application/octet-stream'): ProviderBillArtifact {
  if (bytes.length > PAYMENT_RECON_MAX_FILE_BYTES) throw new HTTPException(413, { message: '账单文件超过 32 MiB' });
  return { bytes, filename, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Only byte-identical evidence shares an object key. Nothing is placed under a public managed-file URL. */
export async function archiveStatement(
  period: PaymentStatementPeriodRow,
  artifacts: ProviderBillArtifact[],
  source: 'provider_download' | 'manual_upload' | 'sandbox_generated',
  verification: Record<string, unknown> = {},
) {
  if (!artifacts.length) throw new HTTPException(400, { message: '渠道未返回可归档账单原件' });
  const normalized = artifacts.map((a) => ({ ...a, ...statementArtifact(a.bytes, a.filename, a.mimeType) }));
  const contentHash = createHash('sha256').update(JSON.stringify(normalized.map((a) => [a.filename, a.sha256]))).digest('hex');
  const [existing] = await db.select().from(paymentStatements).where(and(
    eq(paymentStatements.periodId, period.id), eq(paymentStatements.source, source), eq(paymentStatements.contentHash, contentHash),
    exactTenantCondition(paymentStatements.tenantId, period.tenantId),
  )).limit(1);
  if (existing) return existing;
  const [storage] = await db.select().from(fileStorageConfigs).where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled'))).limit(1);
  requireRow(storage, '请先配置启用的私有文件存储', 409);
  if (storage.objectAcl.startsWith('public') || storage.urlStrategy === 'public') {
    throw new HTTPException(409, { message: '财务账单必须使用私有存储，请修改默认存储访问策略' });
  }
  const files: Array<Omit<typeof paymentStatementFiles.$inferInsert, 'id' | 'statementId' | 'createdAt'>> = [];
  for (const [i, artifact] of normalized.entries()) {
    const storageKey = `payment-statements/${period.tenantId ?? 'platform'}/${period.accountId}/${period.id}/${source}/${contentHash}/${i}-${artifact.sha256}`;
    await uploadObjectByConfig(storage, { objectKey: storageKey, stream: Readable.from(artifact.bytes), size: artifact.bytes.length, mimeType: artifact.mimeType });
    files.push({ storageKey, storageConfigId: storage.id, storageProvider: storage.provider, bucketName: extractBucketName(storage),
      filename: [...artifact.filename].map((char) => /[\\/]/.test(char) || (char.codePointAt(0) ?? 0) < 0x20 ? '_' : char).join('').slice(0, 255), mimeType: artifact.mimeType,
      sha256: artifact.sha256, providerHash: artifact.providerHash ? JSON.stringify(artifact.providerHash) : null,
      byteLength: artifact.bytes.length, tenantId: period.tenantId });
  }
  return db.transaction(async (tx) => {
    await tx.select({ id: paymentStatementPeriods.id }).from(paymentStatementPeriods).where(and(
      eq(paymentStatementPeriods.id, period.id), exactTenantCondition(paymentStatementPeriods.tenantId, period.tenantId),
    )).for('update');
    const [duplicate] = await tx.select().from(paymentStatements).where(and(
      eq(paymentStatements.periodId, period.id), eq(paymentStatements.source, source), eq(paymentStatements.contentHash, contentHash),
    )).limit(1);
    if (duplicate) return duplicate;
    const [last] = await tx.select({ version: paymentStatements.version }).from(paymentStatements)
      .where(eq(paymentStatements.periodId, period.id)).orderBy(desc(paymentStatements.version)).limit(1);
    const [statement] = await tx.insert(paymentStatements).values({ periodId: period.id, version: (last?.version ?? 0) + 1,
      source, contentHash, parserVersion: 'unparsed', status: 'archived', verification, tenantId: period.tenantId }).returning();
    await tx.insert(paymentStatementFiles).values(files.map((file) => ({ ...file, statementId: statement.id })));
    return statement;
  });
}

export async function readStatementFileBytes(file: PaymentStatementFileRow): Promise<Buffer> {
  const [storage] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, requireRow(file.storageConfigId, '账单存储配置缺失', 409))).limit(1);
  requireRow(storage, '账单存储配置不存在', 409);
  const { stream } = await readStoredFile({ objectKey: file.storageKey, provider: file.storageProvider as FileStorageConfigRow['provider'],
    bucketName: file.bucketName, mimeType: file.mimeType, originalName: file.filename }, storage);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PAYMENT_RECON_MAX_FILE_BYTES) throw new HTTPException(413, { message: '账单归档文件大小异常' });
      chunks.push(Buffer.from(chunk.value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== file.byteLength || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new HTTPException(409, { message: '归档账单摘要不一致，拒绝读取' });
  }
  return bytes;
}

export async function downloadStatementFile(id: number) {
  const [file] = await db.select().from(paymentStatementFiles).where(and(eq(paymentStatementFiles.id, id), tenantCondition(paymentStatementFiles, currentUser()))).limit(1);
  requireRow(file, '账单文件不存在');
  return { file, bytes: await readStatementFileBytes(file) };
}

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq, like, or, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { GenerateSelfSignedCertInput, UploadCertInput } from '@zenith/shared';
import { db } from '../db';
import { sslCertificates } from '../db/schema';
import type { SslCertificateRow } from '../db/schema';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { escapeLike, mergeWhere, withPagination } from '../lib/where-helpers';

const execFileAsync = promisify(execFile);
const PEM_CERT_HEADER = '-----BEGIN CERTIFICATE-----';

type SslCertType = 'self_signed' | 'uploaded' | 'letsencrypt';
type SslCertStatus = 'valid' | 'expiring' | 'expired' | 'invalid';
type DownloadKind = 'cert' | 'key';

interface ParsedCertInfo {
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  fingerprint: string | null;
  serialNumber: string | null;
}

export interface ListSslCertificatesQuery {
  keyword?: string;
  type?: SslCertType;
  page: number;
  pageSize: number;
}

function emptyCertInfo(): ParsedCertInfo {
  return {
    issuer: null,
    subject: null,
    validFrom: null,
    validTo: null,
    fingerprint: null,
    serialNumber: null,
  };
}

function getPreferredStorageRoot(overrideRoot?: string) {
  if (overrideRoot?.trim()) return overrideRoot.trim();
  if (process.platform === 'win32') return 'C:\\zenith-ssl';
  if (process.platform === 'darwin') return '/usr/local/etc/ssl/zenith';
  return '/etc/ssl/zenith';
}

async function ensureDir(dir: string) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function resolveStorageRoot(overrideRoot?: string) {
  const preferred = getPreferredStorageRoot(overrideRoot);
  try {
    return await ensureDir(preferred);
  } catch {
    return ensureDir(path.join(process.cwd(), 'storage', 'ssl'));
  }
}

async function resolveCertDir(id: number, overrideRoot?: string) {
  const root = await resolveStorageRoot(overrideRoot);
  return ensureDir(path.join(root, String(id)));
}

function createSubject(domain: string, country?: string, organization?: string) {
  const segments = [`/CN=${domain}`];
  if (country) segments.push(`/C=${country}`);
  if (organization) segments.push(`/O=${organization}`);
  return segments.join('');
}

function createFakeCertPem(domain: string) {
  return `-----BEGIN CERTIFICATE-----\nFAKE-${Buffer.from(domain).toString('base64')}\n-----END CERTIFICATE-----\n`;
}

function createFakeKeyPem(domain: string) {
  return `-----BEGIN PRIVATE KEY-----\nFAKE-${Buffer.from(`key:${domain}`).toString('base64')}\n-----END PRIVATE KEY-----\n`;
}

function createSimulatedCertInfo(domain: string, days: number): ParsedCertInfo {
  const validFrom = new Date();
  const validTo = new Date(validFrom.getTime() + days * 86400000);
  return {
    issuer: `CN=${domain}`,
    subject: `CN=${domain}`,
    validFrom,
    validTo,
    fingerprint: `SIM-${domain}`.slice(0, 128),
    serialNumber: Date.now().toString(16).toUpperCase().slice(0, 128),
  };
}

function calculateStatus(validTo: Date | null | undefined): SslCertStatus {
  if (!validTo) return 'invalid';
  const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86400000);
  if (daysRemaining <= 0) return 'expired';
  if (daysRemaining <= 30) return 'expiring';
  return 'valid';
}

async function parseCertInfo(certPath: string): Promise<ParsedCertInfo> {
  const opensslBin = process.env.OPENSSL_BIN || 'openssl';
  try {
    const { stdout } = await execFileAsync(
      opensslBin,
      ['x509', '-in', certPath, '-noout', '-issuer', '-subject', '-dates', '-fingerprint', '-serial'],
      { windowsHide: true },
    );
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const issuer = lines.find((line) => line.startsWith('issuer='))?.slice('issuer='.length).trim() ?? null;
    const subject = lines.find((line) => line.startsWith('subject='))?.slice('subject='.length).trim() ?? null;
    const validFromText = lines.find((line) => line.startsWith('notBefore='))?.slice('notBefore='.length).trim();
    const validToText = lines.find((line) => line.startsWith('notAfter='))?.slice('notAfter='.length).trim();
    const fingerprintLine = lines.find((line) => line.includes('Fingerprint='));
    const serialNumber = lines.find((line) => line.startsWith('serial='))?.slice('serial='.length).trim() ?? null;
    return {
      issuer,
      subject,
      validFrom: validFromText ? new Date(validFromText) : null,
      validTo: validToText ? new Date(validToText) : null,
      fingerprint: fingerprintLine ? fingerprintLine.slice(fingerprintLine.indexOf('=') + 1).trim() : null,
      serialNumber,
    };
  } catch (error) {
    if (process.platform === 'win32') return emptyCertInfo();
    throw new HTTPException(400, { message: '证书解析失败，请检查 PEM 内容或 openssl 环境' });
  }
}

function mapCert(row: SslCertificateRow) {
  const daysRemaining = row.validTo ? Math.floor((row.validTo.getTime() - Date.now()) / 86400000) : null;
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    type: row.type,
    certPath: row.certPath ?? null,
    keyPath: row.keyPath ?? null,
    issuer: row.issuer ?? null,
    subject: row.subject ?? null,
    validFrom: formatNullableDateTime(row.validFrom),
    validTo: formatNullableDateTime(row.validTo),
    fingerprint: row.fingerprint ?? null,
    serialNumber: row.serialNumber ?? null,
    status: row.status,
    autoRenew: row.autoRenew,
    daysRemaining,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function buildWhere(query: ListSslCertificatesQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.type) {
    conditions.push(eq(sslCertificates.type, query.type));
  }
  if (query.keyword?.trim()) {
    const escaped = escapeLike(query.keyword.trim());
    const keywordCondition = or(
      like(sslCertificates.name, `%${escaped}%`),
      like(sslCertificates.domain, `%${escaped}%`),
    );
    if (keywordCondition) conditions.push(keywordCondition);
  }
  return mergeWhere(and(...conditions));
}

async function syncRowStatus(row: SslCertificateRow) {
  const nextStatus = calculateStatus(row.validTo);
  if (row.status === nextStatus) return row;
  const [updated] = await db
    .update(sslCertificates)
    .set({ status: nextStatus })
    .where(eq(sslCertificates.id, row.id))
    .returning();
  return updated ?? { ...row, status: nextStatus };
}

async function syncRowStatuses(rows: SslCertificateRow[]) {
  return Promise.all(rows.map(syncRowStatus));
}

async function ensureSslCertificateExists(id: number) {
  const [row] = await db.select().from(sslCertificates).where(eq(sslCertificates.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '证书不存在' });
  return row;
}

async function removeCertDirectory(row: SslCertificateRow) {
  const certDir = row.certPath ? path.dirname(row.certPath) : row.keyPath ? path.dirname(row.keyPath) : null;
  if (certDir) {
    await fsp.rm(certDir, { recursive: true, force: true });
  }
}

async function persistCertFiles(id: number, certContent: string, keyContent: string, outputDir?: string) {
  const certDir = await resolveCertDir(id, outputDir);
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');
  await fsp.writeFile(certPath, certContent, 'utf-8');
  await fsp.writeFile(keyPath, keyContent, 'utf-8');
  return { certPath, keyPath };
}

export async function listSslCertificates(query: ListSslCertificatesQuery) {
  const where = buildWhere(query);
  const [total, rows] = await Promise.all([
    db.$count(sslCertificates, where),
    withPagination(
      db.select().from(sslCertificates).where(where).orderBy(desc(sslCertificates.createdAt)).$dynamic(),
      query.page,
      query.pageSize,
    ),
  ]);
  const syncedRows = await syncRowStatuses(rows);
  return { list: syncedRows.map(mapCert), total, page: query.page, pageSize: query.pageSize };
}

export async function getSslCertificate(id: number) {
  return mapCert(await syncRowStatus(await ensureSslCertificateExists(id)));
}

export async function getSslCertificateBeforeAudit(id: number) {
  return mapCert(await ensureSslCertificateExists(id));
}

export async function generateSelfSignedCert(input: GenerateSelfSignedCertInput): Promise<{ id: number }> {
  const days = input.days ?? 365;
  let row: SslCertificateRow | undefined;
  try {
    [row] = await db.insert(sslCertificates).values({
      name: input.name.trim(),
      domain: input.domain.trim(),
      type: 'self_signed',
      autoRenew: false,
    }).returning();

    let certContent = createFakeCertPem(input.domain.trim());
    let keyContent = createFakeKeyPem(input.domain.trim());
    let parsed = process.platform === 'win32'
      ? createSimulatedCertInfo(input.domain.trim(), days)
      : emptyCertInfo();

    const certDir = await resolveCertDir(row.id, input.outputDir);
    const certPath = path.join(certDir, 'cert.pem');
    const keyPath = path.join(certDir, 'key.pem');

    if (process.platform === 'win32') {
      await fsp.writeFile(certPath, certContent, 'utf-8');
      await fsp.writeFile(keyPath, keyContent, 'utf-8');
    } else {
      const opensslBin = process.env.OPENSSL_BIN || 'openssl';
      await execFileAsync(
        opensslBin,
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          String(days),
          '-nodes',
          '-subj',
          createSubject(input.domain.trim(), input.country ?? 'CN', input.organization ?? 'Organization'),
        ],
        { windowsHide: true },
      );
      certContent = await fsp.readFile(certPath, 'utf-8');
      keyContent = await fsp.readFile(keyPath, 'utf-8');
      parsed = await parseCertInfo(certPath);
    }

    await db.update(sslCertificates).set({
      certPath,
      keyPath,
      certContent,
      keyContent,
      issuer: parsed.issuer,
      subject: parsed.subject,
      validFrom: parsed.validFrom,
      validTo: parsed.validTo,
      fingerprint: parsed.fingerprint,
      serialNumber: parsed.serialNumber,
      status: calculateStatus(parsed.validTo),
    }).where(eq(sslCertificates.id, row.id));

    return { id: row.id };
  } catch (error) {
    if (row) {
      await db.delete(sslCertificates).where(eq(sslCertificates.id, row.id));
      await removeCertDirectory(row).catch(() => {});
    }
    if (process.platform !== 'win32' && error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      throw new HTTPException(500, { message: '未找到 openssl 命令，无法生成自签名证书' });
    }
    rethrowPgUniqueViolation(error, '证书名称已存在');
  }
}

export async function uploadCert(input: UploadCertInput): Promise<{ id: number }> {
  const certContent = input.certContent.trim();
  const keyContent = input.keyContent.trim();
  if (!certContent.includes(PEM_CERT_HEADER)) {
    throw new HTTPException(400, { message: '证书内容必须为 PEM 格式' });
  }
  if (!keyContent.includes('PRIVATE KEY')) {
    throw new HTTPException(400, { message: '私钥内容必须为 PEM 格式' });
  }

  let row: SslCertificateRow | undefined;
  try {
    [row] = await db.insert(sslCertificates).values({
      name: input.name.trim(),
      domain: input.domain.trim(),
      type: 'uploaded',
      autoRenew: false,
    }).returning();

    const { certPath, keyPath } = await persistCertFiles(row.id, certContent, keyContent);
    const parsed = await parseCertInfo(certPath);

    await db.update(sslCertificates).set({
      certPath,
      keyPath,
      certContent,
      keyContent,
      issuer: parsed.issuer,
      subject: parsed.subject,
      validFrom: parsed.validFrom,
      validTo: parsed.validTo,
      fingerprint: parsed.fingerprint,
      serialNumber: parsed.serialNumber,
      status: calculateStatus(parsed.validTo),
    }).where(eq(sslCertificates.id, row.id));

    return { id: row.id };
  } catch (error) {
    if (row) {
      const current = await ensureSslCertificateExists(row.id).catch(() => undefined);
      await removeCertDirectory(current ?? row).catch(() => {});
      await db.delete(sslCertificates).where(eq(sslCertificates.id, row.id));
    }
    rethrowPgUniqueViolation(error, '证书名称已存在');
  }
}

export async function deleteSslCertificate(id: number) {
  const row = await ensureSslCertificateExists(id);
  await db.delete(sslCertificates).where(eq(sslCertificates.id, id));
  await removeCertDirectory(row).catch(() => {});
}

export async function getSslCertificateDownload(id: number, kind: DownloadKind) {
  const row = await ensureSslCertificateExists(id);
  const content = kind === 'cert' ? row.certContent : row.keyContent;
  const filePath = kind === 'cert' ? row.certPath : row.keyPath;
  const payload = content ?? (filePath ? await fsp.readFile(filePath, 'utf-8') : null);
  if (!payload) {
    throw new HTTPException(404, { message: kind === 'cert' ? '证书文件不存在' : '私钥文件不存在' });
  }
  return {
    filename: `${row.domain.replaceAll('*', 'wildcard')}-${kind}.pem`,
    content: payload,
    contentType: kind === 'cert' ? 'application/x-x509-ca-cert' : 'application/x-pem-file',
  };
}

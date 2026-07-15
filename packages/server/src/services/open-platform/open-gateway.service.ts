import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, openApiCallLogs } from '../../db/schema';
import type { NewOpenApiCallLog } from '../../db/schema';
import { decryptField } from '../../lib/encryption';

export interface OpenApiAppContext {
  id: number;
  clientId: string;
  name: string;
  allowedScopes: string[];
  ratePlanId: number | null;
  signEnabled: boolean;
  ipAllowlist: string[];
  status: 'enabled' | 'disabled';
  environment: 'production' | 'sandbox';
  reviewStatus: 'draft' | 'pending' | 'approved' | 'rejected';
  /** 当前密钥与宽限期内的上一版本密钥 */
  signingSecrets: string[];
}

/** 按 AppKey（clientId）解析开放 API 应用上下文 */
export async function getOpenApiApp(clientId: string): Promise<OpenApiAppContext | null> {
  const [row] = await db
    .select({
      id: oauth2Clients.id,
      clientId: oauth2Clients.clientId,
      name: oauth2Clients.name,
      allowedScopes: oauth2Clients.allowedScopes,
      ratePlanId: oauth2Clients.ratePlanId,
      signEnabled: oauth2Clients.signEnabled,
      ipAllowlist: oauth2Clients.ipAllowlist,
      status: oauth2Clients.status,
      enc: oauth2Clients.clientSecretEncrypted,
      previousEnc: oauth2Clients.previousClientSecretEncrypted,
      previousExpiresAt: oauth2Clients.previousSecretExpiresAt,
      environment: oauth2Clients.environment,
      reviewStatus: oauth2Clients.reviewStatus,
    })
    .from(oauth2Clients)
    .where(eq(oauth2Clients.clientId, clientId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    allowedScopes: row.allowedScopes ?? [],
    ratePlanId: row.ratePlanId ?? null,
    signEnabled: row.signEnabled,
    ipAllowlist: row.ipAllowlist ?? [],
    status: row.status,
    environment: row.environment,
    reviewStatus: row.reviewStatus,
    signingSecrets: [
      row.enc ? decryptField(row.enc) : null,
      row.previousEnc && row.previousExpiresAt && row.previousExpiresAt > new Date()
        ? decryptField(row.previousEnc)
        : null,
    ].filter((secret): secret is string => Boolean(secret)),
  };
}

/** 写入一条开放 API 调用日志（失败静默，不影响主流程） */
export async function recordOpenApiCall(log: NewOpenApiCallLog): Promise<void> {
  try {
    await db.insert(openApiCallLogs).values(log);
  } catch {
    /* 计量失败不影响业务请求 */
  }
}

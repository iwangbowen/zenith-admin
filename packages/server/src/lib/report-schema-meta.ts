/**
 * 内置只读主库元数据（表/列清单，脱敏），供报表可视化建模与 AI NL2SQL 共用。
 * 敏感表/列（凭据、密钥、会话等）统一在此过滤。
 */
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import type { ReportMetaColumn } from '@zenith/shared';

/** 敏感表：含凭据/密钥/会话等，不对建模与 AI 上下文暴露 */
const SENSITIVE_TABLE_RE = /(^|_)(password|secret|token|tokens|session|sessions|credential|oauth|sso|api_keys?|sms_config|email_config|ai_provider|file_storage|provider_config)s?($|_)/i;
const SENSITIVE_TABLES = new Set([
  'users', 'ai_provider_configs', 'oauth2_clients', 'api_tokens', 'file_storage_configs',
  'email_configs', 'sms_configs', 'user_ai_configs', 'report_datasources',
]);
/** 敏感列：即便所在表暴露，也不返回这些列 */
export const SENSITIVE_COLUMN_RE = /(password|secret|token|api_?key|client_secret|salt|private_key|access_key|refresh_token)/i;

export function isSensitiveTable(table: string): boolean {
  return SENSITIVE_TABLES.has(table) || SENSITIVE_TABLE_RE.test(table);
}

const CACHE_TTL_MS = 5 * 60_000;
let metaCache: { byTable: Map<string, ReportMetaColumn[]>; expire: number } | null = null;

/** 读取 public schema 全部表/列（脱敏 + 5 分钟缓存） */
export async function loadSchemaMeta(): Promise<Map<string, ReportMetaColumn[]>> {
  if (metaCache && metaCache.expire > Date.now()) return metaCache.byTable;
  const rows = (await db.execute(sql.raw(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name NOT LIKE 'drizzle%'
     ORDER BY table_name, ordinal_position`,
  ))) as unknown as { table_name: string; column_name: string; data_type: string }[];
  const byTable = new Map<string, ReportMetaColumn[]>();
  for (const r of rows ?? []) {
    if (isSensitiveTable(r.table_name)) continue;
    if (SENSITIVE_COLUMN_RE.test(r.column_name)) continue;
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push({ name: r.column_name, type: r.data_type });
  }
  metaCache = { byTable, expire: Date.now() + CACHE_TTL_MS };
  return byTable;
}

/** 可视化建模：可用表清单 */
export async function listMetaTables(): Promise<string[]> {
  const byTable = await loadSchemaMeta();
  return [...byTable.keys()].sort((a, b) => a.localeCompare(b));
}

/** 可视化建模：某表列清单（表不存在/敏感 → 404） */
export async function listMetaColumns(table: string): Promise<ReportMetaColumn[]> {
  const byTable = await loadSchemaMeta();
  const cols = byTable.get(table);
  if (!cols) throw new HTTPException(404, { message: '表不存在或不可访问' });
  return cols;
}

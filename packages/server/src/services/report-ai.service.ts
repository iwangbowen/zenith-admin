/**
 * 报表 AI 自然语言取数（NL2SQL）。
 * 复用系统默认 AI 服务商（ai_provider_configs）+ streamChat，
 * 给定库表/字段上下文，将自然语言需求转为只读 SELECT（PostgreSQL）。
 * 生成结果仅返回给前端填入 SQL 编辑器，由既有只读执行器预览，绝不自动写库。
 */
import { HTTPException } from 'hono/http-exception';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { getRawDefaultProviderConfig } from './ai-providers.service';
import { ensureDatasetExists } from './report-dataset.service';
import { streamChat } from '../lib/ai/factory';
import type { ReportField, ReportSqlDatasetContent } from '@zenith/shared';

const MAX_SCHEMA_CHARS = 6000;
const WRITE_KEYWORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|call|do)\b/i;
const SCHEMA_CACHE_TTL_MS = 5 * 60_000;

/** 敏感表：含凭据/密钥/会话等，不纳入 AI schema 上下文，避免 NL2SQL 轻易拖取 */
const SENSITIVE_TABLE_RE = /(^|_)(password|secret|token|tokens|session|sessions|credential|oauth|sso|api_keys?|sms_config|email_config|ai_provider|file_storage|provider_config)s?($|_)/i;
const SENSITIVE_TABLES = new Set([
  'users', 'ai_provider_configs', 'oauth2_clients', 'api_tokens', 'file_storage_configs',
  'email_configs', 'sms_configs', 'user_ai_configs', 'report_datasources',
]);
/** 敏感列：即便所在表暴露，也从 schema 上下文里抹掉这些列名 */
const SENSITIVE_COLUMN_RE = /(password|secret|token|api_?key|client_secret|salt|private_key|access_key|refresh_token)/i;

function isSensitiveTable(t: string): boolean {
  return SENSITIVE_TABLES.has(t) || SENSITIVE_TABLE_RE.test(t);
}

let schemaCache: { text: string; expire: number } | null = null;

/** 读取 public schema 表/字段（脱敏 + 缓存），供 NL2SQL 上下文 */
async function loadSchemaText(): Promise<string> {
  if (schemaCache && schemaCache.expire > Date.now()) return schemaCache.text;
  const rows = (await db.execute(sql.raw(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name NOT LIKE 'drizzle%'
     ORDER BY table_name, ordinal_position`,
  ))) as unknown as { table_name: string; column_name: string }[];

  const byTable = new Map<string, string[]>();
  for (const r of rows ?? []) {
    if (isSensitiveTable(r.table_name)) continue; // 跳过敏感表
    if (SENSITIVE_COLUMN_RE.test(r.column_name)) continue; // 抹掉敏感列
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push(r.column_name);
  }
  let schemaText = '';
  for (const [t, cols] of byTable) {
    if (!cols.length) continue;
    const line = `${t}(${cols.join(', ')})\n`;
    if (schemaText.length + line.length > MAX_SCHEMA_CHARS) { schemaText += '... (schema 已截断)\n'; break; }
    schemaText += line;
  }
  schemaCache = { text: schemaText, expire: Date.now() + SCHEMA_CACHE_TTL_MS };
  return schemaText;
}

/** 从 AI 文本中提取 SQL（剥离 ```sql 围栏、说明文字、末尾分号） */
export function extractSql(text: string): string {
  let t = (text ?? '').trim();
  const fence = /```(?:sql)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  // 取第一个 SELECT/WITH 起到结尾
  const m = /\b(select|with)\b[\s\S]*$/i.exec(t);
  if (m) t = m[0].trim();
  return t.replace(/;\s*$/, '').trim();
}

/** 只读 SELECT 校验（单条、无写关键字） */
export function isReadonlySelectSql(text: string): boolean {
  const t = text.trim();
  if (!/^(select|with)\b/i.test(t)) return false;
  if (/;\s*\S/.test(t)) return false; // 多语句
  if (WRITE_KEYWORDS.test(t)) return false;
  return true;
}

/** 构建库表/字段上下文（脱敏 + 缓存），可选叠加某数据集已有 SQL/字段 */
async function buildSchemaContext(datasetId?: number): Promise<string> {
  const parts: string[] = [];

  if (datasetId) {
    try {
      const ds = await ensureDatasetExists(datasetId);
      const dsSql = (ds.content as ReportSqlDatasetContent)?.sql;
      const fields = (ds.fields ?? []) as ReportField[];
      if (dsSql) parts.push(`【当前数据集 SQL（参考其涉及的表）】\n${dsSql}`);
      if (fields.length) parts.push(`【当前数据集字段】${fields.map((f) => f.name).join(', ')}`);
    } catch { /* 忽略 */ }
  }

  parts.push(`【可用表与字段（PostgreSQL public schema，敏感表/列已隐藏）】\n${await loadSchemaText()}`);
  return parts.join('\n\n');
}

/** 生成只读 SQL */
export async function generateReportSql(input: { question: string; datasetId?: number }): Promise<{ sql: string }> {
  const question = (input.question ?? '').trim();
  if (!question) throw new HTTPException(400, { message: '请描述你想查询的数据' });

  const cfg = await getRawDefaultProviderConfig();
  if (!cfg) throw new HTTPException(503, { message: '系统未配置 AI 服务商，请先在「AI 配置」中设置默认服务商' });

  const schema = await buildSchemaContext(input.datasetId);
  const systemPrompt = `你是资深的 PostgreSQL 工程师。根据用户的自然语言需求，生成一条「只读」SELECT 查询（PostgreSQL 方言）。
严格规则：
- 只能输出一条 SELECT（或以 WITH 开头的 CTE）查询，禁止任何写操作或 DDL。
- 严格使用下方 schema 中真实存在的表名与列名，不要臆造。
- 适当使用聚合、GROUP BY、JOIN；如需限制行数用 LIMIT。
- 只返回 SQL 本身，不要任何解释、注释或 markdown 代码块。

${schema}`;

  let text = '';
  try {
    for await (const chunk of streamChat(cfg.provider, {
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model,
      maxTokens: cfg.maxTokens, temperature: cfg.temperature, systemPrompt,
    }, [{ role: 'user', content: question }])) {
      if (chunk.type === 'delta') text += chunk.content;
      else if (chunk.type === 'error') throw new HTTPException(502, { message: `AI 生成失败：${chunk.error}` });
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(502, { message: 'AI 服务调用失败，请稍后重试' });
  }

  const generated = extractSql(text);
  if (!generated) throw new HTTPException(422, { message: 'AI 未能生成有效 SQL，请调整描述后重试' });
  if (!isReadonlySelectSql(generated)) {
    throw new HTTPException(422, { message: 'AI 生成的语句非只读 SELECT，已拦截' });
  }
  return { sql: generated };
}

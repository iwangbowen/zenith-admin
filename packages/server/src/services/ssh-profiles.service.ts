import { eq, and, asc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { db } from '../db';
import { sshProfiles } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { encryptField, decryptField } from '../lib/encryption';

export interface SshProfileInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key_path' | 'key_content' | 'agent';
  password?: string | null;
  keyPath?: string | null;
  keyContent?: string | null;
  keyPassphrase?: string | null;
  envVars?: Record<string, string>;
  groupName?: string | null;
  tags?: string[];
  orderNum?: number;
}

function mapRow(r: typeof sshProfiles.$inferSelect) {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    authType: r.authType,
    hasPassword: !!r.passwordEncrypted,
    keyPath: r.keyPath ?? null,
    hasKeyContent: !!r.keyContentEncrypted,
    hasKeyPassphrase: !!r.keyPassphraseEncrypted,
    envVars: r.envVars ?? {},
    groupName: r.groupName ?? null,
    tags: r.tags ?? [],
    orderNum: r.orderNum,
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  };
}

export async function listSshProfiles(userId: number) {
  const rows = await db
    .select()
    .from(sshProfiles)
    .where(eq(sshProfiles.userId, userId))
    .orderBy(asc(sshProfiles.orderNum), asc(sshProfiles.id));
  return rows.map(mapRow);
}

export async function getSshProfile(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(sshProfiles)
    .where(and(eq(sshProfiles.id, id), eq(sshProfiles.userId, userId)));
  if (!row) throw new HTTPException(404, { message: 'SSH 配置不存在' });
  return mapRow(row);
}

export async function createSshProfile(userId: number, input: SshProfileInput) {
  const [row] = await db
    .insert(sshProfiles)
    .values({
      userId,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      passwordEncrypted: encryptField(input.password),
      keyPath: input.keyPath ?? null,
      keyContentEncrypted: encryptField(input.keyContent),
      keyPassphraseEncrypted: encryptField(input.keyPassphrase),
      envVars: input.envVars ?? {},
      groupName: input.groupName ?? null,
      tags: input.tags ?? [],
      orderNum: input.orderNum ?? 0,
    })
    .returning();
  return mapRow(row);
}

export async function updateSshProfile(id: number, userId: number, input: Partial<SshProfileInput>) {
  const existing = await ensureSshProfile(id, userId);
  const [row] = await db
    .update(sshProfiles)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.host !== undefined && { host: input.host }),
      ...(input.port !== undefined && { port: input.port }),
      ...(input.username !== undefined && { username: input.username }),
      ...(input.authType !== undefined && { authType: input.authType }),
      // 密码/私钥：null 表示清空，undefined 表示不修改
      ...(input.password !== undefined && { passwordEncrypted: encryptField(input.password) }),
      ...(input.keyPath !== undefined && { keyPath: input.keyPath }),
      ...(input.keyContent !== undefined && { keyContentEncrypted: encryptField(input.keyContent) }),
      ...(input.keyPassphrase !== undefined && { keyPassphraseEncrypted: encryptField(input.keyPassphrase) }),
      ...(input.envVars !== undefined && { envVars: input.envVars }),
      ...(input.groupName !== undefined && { groupName: input.groupName }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.orderNum !== undefined && { orderNum: input.orderNum }),
    })
    .where(eq(sshProfiles.id, existing.id))
    .returning();
  return mapRow(row);
}

export async function deleteSshProfile(id: number, userId: number) {
  await ensureSshProfile(id, userId);
  await db.delete(sshProfiles).where(eq(sshProfiles.id, id));
}

async function ensureSshProfile(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(sshProfiles)
    .where(and(eq(sshProfiles.id, id), eq(sshProfiles.userId, userId)));
  if (!row) throw new HTTPException(404, { message: 'SSH 配置不存在' });
  return row;
}

/**
 * 获取用于 ssh2 连接的认证参数。
 * 仅在服务端调用，解密敏感字段后返回明文。
 */
export async function getSshConnectParams(id: number, userId: number) {
  const row = await ensureSshProfile(id, userId);
  const base = {
    host: row.host,
    port: row.port,
    username: row.username,
    envVars: row.envVars ?? {},
    authType: row.authType,
  };

  if (row.authType === 'password') {
    const password = decryptField(row.passwordEncrypted);
    if (!password) throw new HTTPException(400, { message: 'SSH 密码未配置' });
    return { ...base, password };
  }

  if (row.authType === 'key_path') {
    const keyPath = row.keyPath?.replace('~', homedir()) ?? '';
    if (!keyPath) throw new HTTPException(400, { message: 'SSH 私钥路径未配置' });
    let privateKey: string;
    try {
      privateKey = readFileSync(keyPath, 'utf8');
    } catch {
      throw new HTTPException(400, { message: `无法读取私钥文件: ${keyPath}` });
    }
    const passphrase = decryptField(row.keyPassphraseEncrypted) ?? undefined;
    return { ...base, privateKey, passphrase };
  }

  if (row.authType === 'key_content') {
    const privateKey = decryptField(row.keyContentEncrypted);
    if (!privateKey) throw new HTTPException(400, { message: 'SSH 私钥内容未配置' });
    const passphrase = decryptField(row.keyPassphraseEncrypted) ?? undefined;
    return { ...base, privateKey, passphrase };
  }

  if (row.authType === 'agent') {
    const agent = process.env.SSH_AUTH_SOCK;
    if (!agent) throw new HTTPException(400, { message: '服务端 ssh-agent 未运行（未检测到 SSH_AUTH_SOCK）' });
    return { ...base, agent };
  }

  throw new HTTPException(400, { message: '未知的认证方式' });
}

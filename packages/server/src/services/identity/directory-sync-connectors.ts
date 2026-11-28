import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { oauthConfigs, type DirectorySyncSourceRow } from '../../db/schema';
import { httpGet, httpPost } from '../../lib/http-client';
import {
  getUsableDirectoryProvider,
  mapDirectoryProfile,
  searchDirectoryEntries,
} from './identity-providers.service';

/** 外部部门（连接器统一输出格式） */
export interface DirectoryExtDept {
  externalId: string;
  name: string;
  /** null = 挂在根节点下 */
  parentExternalId: string | null;
  sort?: number;
}

/** 外部用户（连接器统一输出格式） */
export interface DirectoryExtUser {
  externalId: string;
  username: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  /** 归属外部部门（首个视为主部门） */
  deptExternalIds: string[];
}

export interface DirectorySnapshot {
  departments: DirectoryExtDept[];
  users: DirectoryExtUser[];
}

export interface DirectoryConnectorTestResult {
  ok: boolean;
  message: string;
  sampleUsers: Array<{ externalId: string; username: string; nickname: string }>;
}

export interface DirectoryConnector {
  fetch(): Promise<DirectorySnapshot>;
  test(): Promise<DirectoryConnectorTestResult>;
}

const LDAP_SYNC_FETCH_LIMIT = 5000;

// ─── LDAP / AD 连接器：连接与凭证复用企业身份源 ──────────────────────────────────
function createLdapConnector(source: DirectorySyncSourceRow): DirectoryConnector {
  const providerId = source.identityProviderId;
  if (!providerId) throw new HTTPException(400, { message: '同步源未绑定企业身份源' });

  async function fetchSnapshot(limit: number): Promise<DirectorySnapshot> {
    const provider = await getUsableDirectoryProvider(providerId!, source.tenantId);
    const entries = await searchDirectoryEntries(provider, { mode: 'sync', limit });
    const users: DirectoryExtUser[] = [];
    const deptNames = new Map<string, DirectoryExtDept>();
    for (const entry of entries) {
      const { user } = mapDirectoryProfile(provider, entry);
      const deptName = user.department?.trim() || null;
      let deptExternalIds: string[] = [];
      if (deptName) {
        const externalId = `name:${deptName}`;
        if (!deptNames.has(externalId)) {
          deptNames.set(externalId, { externalId, name: deptName, parentExternalId: null });
        }
        deptExternalIds = [externalId];
      }
      users.push({
        externalId: user.subject,
        username: user.username,
        nickname: user.nickname,
        email: user.email ?? null,
        phone: user.phone ?? null,
        active: true,
        deptExternalIds,
      });
    }
    return { departments: Array.from(deptNames.values()), users };
  }

  return {
    fetch: () => fetchSnapshot(LDAP_SYNC_FETCH_LIMIT),
    async test() {
      try {
        const snapshot = await fetchSnapshot(3);
        return {
          ok: true,
          message: `连接成功，抽样 ${snapshot.users.length} 个目录用户`,
          sampleUsers: snapshot.users.slice(0, 3).map((u) => ({ externalId: u.externalId, username: u.username, nickname: u.nickname })),
        };
      } catch (err) {
        return { ok: false, message: `连接失败：${err instanceof Error ? err.message : '未知错误'}`, sampleUsers: [] };
      }
    },
  };
}

// ─── 钉钉连接器：凭证复用 OAuth 配置（appKey/appSecret = clientId/clientSecret）───
const DINGTALK_API = 'https://oapi.dingtalk.com';

const DINGTALK_ROOT_DEPT_ID = 1;

interface DingTalkTokenCache {
  token: string;
  expiresAt: number;
}

const dingTalkTokenCache = new Map<string, DingTalkTokenCache>();

interface DingTalkDeptRaw {
  dept_id: number;
  name: string;
  parent_id: number;
}

interface DingTalkUserRaw {
  userid: string;
  name: string;
  mobile?: string;
  email?: string;
  org_email?: string;
  active?: boolean;
  dept_id_list?: number[];
}

async function getDingTalkCredentials() {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, 'dingtalk')).limit(1);
  if (!row?.clientId || !row.clientSecret) {
    throw new HTTPException(400, { message: '钉钉 OAuth 配置缺失，请先在「OAuth 配置」中填写 appKey/appSecret' });
  }
  return { appKey: row.clientId, appSecret: row.clientSecret };
}

async function getDingTalkToken(): Promise<string> {
  const { appKey, appSecret } = await getDingTalkCredentials();
  const cached = dingTalkTokenCache.get(appKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const resp = await httpGet(`${DINGTALK_API}/gettoken?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`, {
    timeout: 10_000,
    retries: 1,
  });
  const data = await resp.json<{ errcode?: number; errmsg?: string; access_token?: string; expires_in?: number }>();
  if (!resp.ok || data.errcode !== 0 || !data.access_token) {
    throw new HTTPException(400, { message: `钉钉获取 access_token 失败：${data.errmsg ?? `HTTP ${resp.status}`}` });
  }
  dingTalkTokenCache.set(appKey, {
    token: data.access_token,
    // 官方 7200s，提前 5 分钟过期
    expiresAt: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000,
  });
  return data.access_token;
}

async function dingTalkApi<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
  const resp = await httpPost(`${DINGTALK_API}${path}?access_token=${encodeURIComponent(token)}`, JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    timeout: 15_000,
    retries: 1,
  });
  const data = await resp.json<{ errcode?: number; errmsg?: string; result?: T }>();
  if (!resp.ok || data.errcode !== 0) {
    throw new HTTPException(400, { message: `钉钉接口 ${path} 调用失败：${data.errmsg ?? `HTTP ${resp.status}`}` });
  }
  return data.result as T;
}

async function fetchDingTalkDepartments(token: string): Promise<DirectoryExtDept[]> {
  const depts: DirectoryExtDept[] = [];
  const queue: number[] = [DINGTALK_ROOT_DEPT_ID];
  const seen = new Set<number>(queue);
  while (queue.length > 0) {
    const deptId = queue.shift()!;
    const children = await dingTalkApi<DingTalkDeptRaw[]>(token, '/topapi/v2/department/listsub', { dept_id: deptId });
    for (const child of children ?? []) {
      if (seen.has(child.dept_id)) continue;
      seen.add(child.dept_id);
      depts.push({
        externalId: String(child.dept_id),
        name: child.name,
        parentExternalId: child.parent_id === DINGTALK_ROOT_DEPT_ID ? null : String(child.parent_id),
      });
      queue.push(child.dept_id);
    }
  }
  return depts;
}

async function fetchDingTalkUsersOfDept(token: string, deptId: number): Promise<DingTalkUserRaw[]> {
  const list: DingTalkUserRaw[] = [];
  let cursor = 0;
  for (;;) {
    const result = await dingTalkApi<{ list?: DingTalkUserRaw[]; has_more?: boolean; next_cursor?: number }>(
      token,
      '/topapi/v2/user/list',
      { dept_id: deptId, cursor, size: 100 },
    );
    list.push(...(result.list ?? []));
    if (!result.has_more || result.next_cursor == null) break;
    cursor = result.next_cursor;
  }
  return list;
}

function createDingTalkConnector(): DirectoryConnector {
  async function fetchSnapshot(): Promise<DirectorySnapshot> {
    const token = await getDingTalkToken();
    const departments = await fetchDingTalkDepartments(token);
    const deptIds = [DINGTALK_ROOT_DEPT_ID, ...departments.map((d) => Number(d.externalId))];
    const userMap = new Map<string, DirectoryExtUser>();
    for (const deptId of deptIds) {
      const rawUsers = await fetchDingTalkUsersOfDept(token, deptId);
      for (const raw of rawUsers) {
        if (userMap.has(raw.userid)) continue;
        const deptExternalIds = (raw.dept_id_list ?? [deptId])
          .filter((id) => id !== DINGTALK_ROOT_DEPT_ID)
          .map((id) => String(id));
        userMap.set(raw.userid, {
          externalId: raw.userid,
          username: raw.mobile?.trim() || raw.userid,
          nickname: raw.name,
          email: raw.email?.trim() || raw.org_email?.trim() || null,
          phone: raw.mobile?.trim() || null,
          active: raw.active !== false,
          deptExternalIds,
        });
      }
    }
    return { departments, users: Array.from(userMap.values()) };
  }

  return {
    fetch: fetchSnapshot,
    async test() {
      try {
        const token = await getDingTalkToken();
        const children = await dingTalkApi<DingTalkDeptRaw[]>(token, '/topapi/v2/department/listsub', { dept_id: DINGTALK_ROOT_DEPT_ID });
        return {
          ok: true,
          message: `连接成功，根部门下有 ${children?.length ?? 0} 个子部门`,
          sampleUsers: [],
        };
      } catch (err) {
        return { ok: false, message: `连接失败：${err instanceof Error ? err.message : '未知错误'}`, sampleUsers: [] };
      }
    },
  };
}

// ─── 企业微信连接器：corpId 复用 OAuth 配置，通讯录 Secret 存于同步源 ─────────────
const WECOM_API = 'https://qyapi.weixin.qq.com';

const wecomTokenCache = new Map<string, DingTalkTokenCache>();

interface WeComDeptRaw {
  id: number;
  name: string;
  parentid: number;
}

interface WeComUserRaw {
  userid: string;
  name: string;
  mobile?: string;
  email?: string;
  biz_mail?: string;
  /** 1=已激活 2=已禁用 4=未激活 5=退出企业 */
  status?: number;
  enable?: number;
  department?: number[];
}

const WECOM_ROOT_DEPT_ID = 1;

async function getWeComToken(source: DirectorySyncSourceRow): Promise<string> {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, 'wechat_work')).limit(1);
  if (!row?.corpId) {
    throw new HTTPException(400, { message: '企业微信 OAuth 配置缺失 Corp ID，请先在「OAuth 配置」中填写' });
  }
  const contactSecret = source.contactSecret?.trim();
  if (!contactSecret) throw new HTTPException(400, { message: '同步源未配置企业微信通讯录 Secret' });
  const cacheKey = `${row.corpId}:${source.id}`;
  const cached = wecomTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const resp = await httpGet(`${WECOM_API}/cgi-bin/gettoken?corpid=${encodeURIComponent(row.corpId)}&corpsecret=${encodeURIComponent(contactSecret)}`, {
    timeout: 10_000,
    retries: 1,
  });
  const data = await resp.json<{ errcode?: number; errmsg?: string; access_token?: string; expires_in?: number }>();
  if (!resp.ok || data.errcode !== 0 || !data.access_token) {
    throw new HTTPException(400, { message: `企业微信获取 access_token 失败：${data.errmsg ?? `HTTP ${resp.status}`}` });
  }
  wecomTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000,
  });
  return data.access_token;
}

async function wecomGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ access_token: token, ...params });
  const resp = await httpGet(`${WECOM_API}${path}?${search}`, { timeout: 15_000, retries: 1 });
  const data = await resp.json<Record<string, unknown> & { errcode?: number; errmsg?: string }>();
  if (!resp.ok || data.errcode !== 0) {
    throw new HTTPException(400, { message: `企业微信接口 ${path} 调用失败：${data.errmsg ?? `HTTP ${resp.status}`}` });
  }
  return data as T;
}

function createWeComConnector(source: DirectorySyncSourceRow): DirectoryConnector {
  async function fetchSnapshot(): Promise<DirectorySnapshot> {
    const token = await getWeComToken(source);
    const deptResp = await wecomGet<{ department?: WeComDeptRaw[] }>(token, '/cgi-bin/department/list', {});
    const departments: DirectoryExtDept[] = (deptResp.department ?? [])
      .filter((d) => d.id !== WECOM_ROOT_DEPT_ID)
      .map((d) => ({
        externalId: String(d.id),
        name: d.name,
        parentExternalId: d.parentid === WECOM_ROOT_DEPT_ID ? null : String(d.parentid),
      }));
    // fetch_child=1 从根部门一次拉全量成员
    const userResp = await wecomGet<{ userlist?: WeComUserRaw[] }>(token, '/cgi-bin/user/list', {
      department_id: String(WECOM_ROOT_DEPT_ID),
      fetch_child: '1',
    });
    const users: DirectoryExtUser[] = (userResp.userlist ?? []).map((raw) => ({
      externalId: raw.userid,
      username: raw.mobile?.trim() || raw.userid,
      nickname: raw.name,
      email: raw.email?.trim() || raw.biz_mail?.trim() || null,
      phone: raw.mobile?.trim() || null,
      active: raw.status !== 5 && raw.enable !== 0,
      deptExternalIds: (raw.department ?? [])
        .filter((id) => id !== WECOM_ROOT_DEPT_ID)
        .map((id) => String(id)),
    }));
    return { departments, users };
  }

  return {
    fetch: fetchSnapshot,
    async test() {
      try {
        const token = await getWeComToken(source);
        const deptResp = await wecomGet<{ department?: WeComDeptRaw[] }>(token, '/cgi-bin/department/list', {});
        return { ok: true, message: `连接成功，共 ${deptResp.department?.length ?? 0} 个部门`, sampleUsers: [] };
      } catch (err) {
        return { ok: false, message: `连接失败：${err instanceof Error ? err.message : '未知错误'}`, sampleUsers: [] };
      }
    },
  };
}

// ─── 飞书连接器：凭证复用 OAuth 配置（App ID / App Secret），走 app_access_token ──
const FEISHU_API = 'https://open.feishu.cn';

const feishuTokenCache = new Map<string, DingTalkTokenCache>();

const FEISHU_ROOT_DEPT_ID = '0';

interface FeishuDeptRaw {
  open_department_id: string;
  name: string;
  parent_department_id?: string;
  order?: string;
}

interface FeishuUserRaw {
  open_id: string;
  name: string;
  mobile?: string;
  email?: string;
  enterprise_email?: string;
  status?: { is_frozen?: boolean; is_resigned?: boolean; is_exited?: boolean };
  department_ids?: string[];
}

async function getFeishuToken(): Promise<string> {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, 'feishu')).limit(1);
  if (!row?.clientId || !row.clientSecret) {
    throw new HTTPException(400, { message: '飞书 OAuth 配置缺失，请先在「OAuth 配置」中填写 App ID / App Secret' });
  }
  const cached = feishuTokenCache.get(row.clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const resp = await httpPost(`${FEISHU_API}/open-apis/auth/v3/app_access_token/internal`, JSON.stringify({
    app_id: row.clientId,
    app_secret: row.clientSecret,
  }), {
    headers: { 'content-type': 'application/json' },
    timeout: 10_000,
    retries: 1,
  });
  const data = await resp.json<{ code?: number; msg?: string; app_access_token?: string; expire?: number }>();
  if (!resp.ok || data.code !== 0 || !data.app_access_token) {
    throw new HTTPException(400, { message: `飞书获取 app_access_token 失败：${data.msg ?? `HTTP ${resp.status}`}` });
  }
  feishuTokenCache.set(row.clientId, {
    token: data.app_access_token,
    expiresAt: Date.now() + ((data.expire ?? 7200) - 300) * 1000,
  });
  return data.app_access_token;
}

async function feishuGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams(params);
  const resp = await httpGet(`${FEISHU_API}${path}?${search}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
    retries: 1,
  });
  const data = await resp.json<{ code?: number; msg?: string; data?: T }>();
  if (!resp.ok || data.code !== 0) {
    throw new HTTPException(400, { message: `飞书接口 ${path} 调用失败：${data.msg ?? `HTTP ${resp.status}`}` });
  }
  return (data.data ?? {}) as T;
}

async function fetchFeishuDepartments(token: string): Promise<DirectoryExtDept[]> {
  const depts: DirectoryExtDept[] = [];
  const queue: string[] = [FEISHU_ROOT_DEPT_ID];
  const seen = new Set<string>(queue);
  while (queue.length > 0) {
    const deptId = queue.shift()!;
    let pageToken = '';
    do {
      const data = await feishuGet<{ items?: FeishuDeptRaw[]; has_more?: boolean; page_token?: string }>(
        token,
        `/open-apis/contact/v3/departments/${encodeURIComponent(deptId)}/children`,
        { department_id_type: 'open_department_id', page_size: '50', ...(pageToken ? { page_token: pageToken } : {}) },
      );
      for (const item of data.items ?? []) {
        if (seen.has(item.open_department_id)) continue;
        seen.add(item.open_department_id);
        depts.push({
          externalId: item.open_department_id,
          name: item.name,
          parentExternalId: !item.parent_department_id || item.parent_department_id === FEISHU_ROOT_DEPT_ID
            ? null
            : item.parent_department_id,
        });
        queue.push(item.open_department_id);
      }
      pageToken = data.has_more && data.page_token ? data.page_token : '';
    } while (pageToken);
  }
  return depts;
}

async function fetchFeishuUsersOfDept(token: string, deptId: string): Promise<FeishuUserRaw[]> {
  const list: FeishuUserRaw[] = [];
  let pageToken = '';
  do {
    const data = await feishuGet<{ items?: FeishuUserRaw[]; has_more?: boolean; page_token?: string }>(
      token,
      '/open-apis/contact/v3/users/find_by_department',
      {
        department_id: deptId,
        department_id_type: 'open_department_id',
        page_size: '50',
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    );
    list.push(...(data.items ?? []));
    pageToken = data.has_more && data.page_token ? data.page_token : '';
  } while (pageToken);
  return list;
}

function createFeishuConnector(): DirectoryConnector {
  async function fetchSnapshot(): Promise<DirectorySnapshot> {
    const token = await getFeishuToken();
    const departments = await fetchFeishuDepartments(token);
    const deptIds = [FEISHU_ROOT_DEPT_ID, ...departments.map((d) => d.externalId)];
    const userMap = new Map<string, DirectoryExtUser>();
    for (const deptId of deptIds) {
      const rawUsers = await fetchFeishuUsersOfDept(token, deptId);
      for (const raw of rawUsers) {
        if (userMap.has(raw.open_id)) continue;
        userMap.set(raw.open_id, {
          externalId: raw.open_id,
          username: raw.mobile?.replace(/^\+86/, '').trim() || raw.open_id,
          nickname: raw.name,
          email: raw.email?.trim() || raw.enterprise_email?.trim() || null,
          phone: raw.mobile?.replace(/^\+86/, '').trim() || null,
          active: !raw.status?.is_resigned && !raw.status?.is_exited && !raw.status?.is_frozen,
          deptExternalIds: (raw.department_ids ?? []).filter((id) => id !== FEISHU_ROOT_DEPT_ID),
        });
      }
    }
    return { departments, users: Array.from(userMap.values()) };
  }

  return {
    fetch: fetchSnapshot,
    async test() {
      try {
        const token = await getFeishuToken();
        const data = await feishuGet<{ items?: FeishuDeptRaw[] }>(
          token,
          `/open-apis/contact/v3/departments/${FEISHU_ROOT_DEPT_ID}/children`,
          { department_id_type: 'open_department_id', page_size: '10' },
        );
        return { ok: true, message: `连接成功，根部门下有 ${data.items?.length ?? 0} 个子部门`, sampleUsers: [] };
      } catch (err) {
        return { ok: false, message: `连接失败：${err instanceof Error ? err.message : '未知错误'}`, sampleUsers: [] };
      }
    },
  };
}

/** 按同步源类型构建连接器 */
export function buildDirectoryConnector(source: DirectorySyncSourceRow): DirectoryConnector {
  switch (source.type) {
    case 'ldap': return createLdapConnector(source);
    case 'dingtalk': return createDingTalkConnector();
    case 'wechat_work': return createWeComConnector(source);
    case 'feishu': return createFeishuConnector();
    default: throw new HTTPException(400, { message: `不支持的同步源类型：${source.type}` });
  }
}

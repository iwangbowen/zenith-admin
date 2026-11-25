/**
 * 接口目录：由契约派生的只读视图。服务端据此提供 `GET /api/api-catalog`（前端不直接 import 契约聚合，
 * 见 `permission-catalog-core.ts` 的说明）；「角色 / 用户各自持有哪些权限码」由权限矩阵端点补充。
 *
 * 没有任何新表：接口需要什么权限 = 契约声明；谁拥有什么权限 = 角色 / 用户 / 用户组绑定的页面与权限码。
 */
import { accessPermissions, accessPlatformOnly, type AnyOperation, type OperationAccess, type SecurityScheme } from './core/contract';
import type { Permission } from './core/permissions';
import { CONTRACT_DOMAIN_LABELS, CONTRACTS_BY_DOMAIN, listAllOperations, type ContractDomain } from './contracts';
import type { ApiCatalog, ApiCatalogItem } from './identity/contracts/api-catalog';
import { accessKindOf, type AccessKind } from './permission-catalog-core';
import { ALL_PERMISSIONS } from './permissions';

export * from './permission-catalog-core';

/** 目录里的一个接口：全部凭证类型都收录；只有后台登录令牌操作带 `access` */
export interface ApiCatalogEntry {
  readonly domain: ContractDomain;
  readonly basePath: string;
  readonly name: string;
  readonly method: AnyOperation['method'];
  readonly fullPath: string;
  readonly summary: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  readonly security: SecurityScheme;
  /** 后台登录令牌操作必有；其它凭证为 null */
  readonly access: OperationAccess | null;
  readonly accessKind: AccessKind | null;
  /** 任一即可的权限码；`authenticated` / 仅平台超管 / 非 bearer → 空 */
  readonly permissions: readonly Permission[];
  readonly platformOnly: false | true | 'multi-tenant';
  readonly audit: string | null;
  readonly feature: string | null;
}

/** 权限目录条目：仅后台登录令牌操作，`access` 必有 */
export interface PermissionCatalogEntry extends ApiCatalogEntry {
  readonly security: 'bearer';
  readonly access: OperationAccess;
  readonly accessKind: AccessKind;
}

/** 全部契约操作（含公开 / 会员 / 设备 / 开放网关），按域 → 契约组 → 声明顺序 */
export function listApiCatalog(): ApiCatalogEntry[] {
  const entries: ApiCatalogEntry[] = [];
  for (const { domain, contract, op } of listAllOperations()) {
    const access = op.security === 'bearer' ? (op.access ?? null) : null;
    entries.push({
      domain,
      basePath: contract.basePath,
      name: op.name,
      method: op.method,
      fullPath: op.fullPath,
      summary: op.summary,
      description: op.description ?? null,
      tags: op.tags,
      deprecated: op.deprecated,
      security: op.security,
      access,
      accessKind: access ? accessKindOf(access) : null,
      permissions: access ? accessPermissions(access) : [],
      platformOnly: access ? accessPlatformOnly(access) : false,
      audit: op.audit?.description ?? null,
      feature: op.feature ?? null,
    });
  }
  return entries;
}

function isPermissionCatalogEntry(entry: ApiCatalogEntry): entry is PermissionCatalogEntry {
  return entry.security === 'bearer' && entry.access !== null;
}

/** 全部后台登录令牌操作（公开 / 会员 / 设备 / 开放网关操作不在权限矩阵范围内） */
export function listPermissionCatalog(catalog: readonly ApiCatalogEntry[] = listApiCatalog()): PermissionCatalogEntry[] {
  return catalog.filter(isPermissionCatalogEntry);
}

/** 权限码 → 引用它的操作（同一码可被多个接口引用；`uiOnly` 的码不会出现在这里） */
export function operationsByPermission(catalog: readonly PermissionCatalogEntry[] = listPermissionCatalog()): Map<Permission, PermissionCatalogEntry[]> {
  const map = new Map<Permission, PermissionCatalogEntry[]>();
  for (const entry of catalog) {
    for (const code of entry.permissions) {
      const list = map.get(code) ?? [];
      list.push(entry);
      map.set(code, list);
    }
  }
  return map;
}

export const PERMISSION_CATALOG_DOMAINS = Object.keys(CONTRACTS_BY_DOMAIN) as ContractDomain[];

// ─── 契约响应形状（GET /api/api-catalog） ────────────────────────────────────

/**
 * `GET /api/api-catalog` 的响应：目录条目 + 引用到的权限码的注册表标签。
 * 服务端与 Demo Mock 共用；目录随发布静态可知，调用方自行缓存。
 */
export function buildApiCatalog(): ApiCatalog {
  const permissionLabels: Record<string, string> = {};
  const items: ApiCatalogItem[] = listApiCatalog().map((entry) => {
    for (const code of entry.permissions) {
      const label = ALL_PERMISSIONS[code]?.label;
      if (label) permissionLabels[code] = label;
    }
    return {
      domain: entry.domain,
      domainLabel: CONTRACT_DOMAIN_LABELS[entry.domain] ?? entry.domain,
      basePath: entry.basePath,
      name: entry.name,
      method: entry.method,
      fullPath: entry.fullPath,
      summary: entry.summary,
      description: entry.description,
      tags: [...entry.tags],
      deprecated: entry.deprecated,
      security: entry.security,
      accessKind: entry.accessKind,
      permissions: [...entry.permissions],
      platformOnly: entry.platformOnly,
      audit: entry.audit,
      feature: entry.feature,
    };
  });
  return { items, permissionLabels };
}

/**
 * 报表数据源安全单测：连接配置规整 + 敏感头/密码加密、脱敏、解密往返。
 * normalizeDatasourceConfig（写入加密）→ resolveApiHeaders（取数解密）→ mapDatasource（展示脱敏）。
 */
import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { normalizeDatasourceConfig, resolveApiHeaders, mapDatasource } from './report-datasource.service';
import { decryptField } from '../lib/encryption';
import type { ReportDatasourceRow } from '../db/schema';
import type { ReportApiDatasourceConfig, ReportExternalDbConfig } from '@zenith/shared';

const rowOf = (over: Partial<ReportDatasourceRow>): ReportDatasourceRow => ({
  id: 1, name: 'ds', type: 'api', config: {}, status: 'enabled', remark: null,
  createdBy: null, updatedBy: null, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
} as ReportDatasourceRow);

describe('normalizeDatasourceConfig - API', () => {
  it('校验 URL：非 http(s) 抛 400', () => {
    expect(() => normalizeDatasourceConfig('api', { url: 'ftp://x' })).toThrow(HTTPException);
    expect(() => normalizeDatasourceConfig('api', {})).toThrow(HTTPException);
  });
  it('method 仅保留 GET/POST', () => {
    expect((normalizeDatasourceConfig('api', { url: 'https://x', method: 'DELETE' }) as ReportApiDatasourceConfig).method).toBe('GET');
    expect((normalizeDatasourceConfig('api', { url: 'https://x', method: 'POST' }) as ReportApiDatasourceConfig).method).toBe('POST');
  });
  it('敏感头加密存储，非敏感头明文', () => {
    const cfg = normalizeDatasourceConfig('api', { url: 'https://x', headers: { authorization: 'Bearer s', 'x-trace': 'abc' } }) as ReportApiDatasourceConfig;
    expect(cfg.headers!.authorization).not.toBe('Bearer s');           // 已加密
    expect(decryptField(cfg.headers!.authorization)).toBe('Bearer s'); // 可解回
    expect(cfg.headers!['x-trace']).toBe('abc');                       // 非敏感不动
  });
  it('提交掩码且存在旧密文时沿用旧密文', () => {
    const current: ReportApiDatasourceConfig = { url: 'https://x', method: 'GET', headers: { authorization: 'OLD_CIPHER' } };
    const cfg = normalizeDatasourceConfig('api', { url: 'https://x', headers: { authorization: '******' } }, current) as ReportApiDatasourceConfig;
    expect(cfg.headers!.authorization).toBe('OLD_CIPHER');
  });
});

describe('resolveApiHeaders - 取数解密往返', () => {
  it('敏感头解密为明文，非敏感原样', () => {
    const stored = normalizeDatasourceConfig('api', { url: 'https://x', headers: { authorization: 'Bearer s', 'x-trace': 'abc' } }) as ReportApiDatasourceConfig;
    const resolved = resolveApiHeaders(stored.headers)!;
    expect(resolved.authorization).toBe('Bearer s');
    expect(resolved['x-trace']).toBe('abc');
  });
});

describe('normalizeDatasourceConfig - 外部库 / 内置 / 静态', () => {
  it('外部库缺 host/database/user 抛 400', () => {
    expect(() => normalizeDatasourceConfig('mysql', { host: '', database: 'd', user: 'u' })).toThrow(HTTPException);
  });
  it('外部库密码加密存储，可解回；未提供则沿用旧密文', () => {
    const cfg = normalizeDatasourceConfig('postgresql', { host: 'h', database: 'd', user: 'u', password: 'p@ss' }) as ReportExternalDbConfig;
    expect(cfg.password).not.toBe('p@ss');
    expect(decryptField(cfg.password!)).toBe('p@ss');
    expect(cfg.port).toBe(5432); // 默认端口

    const current: ReportExternalDbConfig = { host: 'h', port: 5432, database: 'd', user: 'u', password: 'OLD_CIPHER' };
    const kept = normalizeDatasourceConfig('postgresql', { host: 'h', database: 'd', user: 'u' }, current) as ReportExternalDbConfig;
    expect(kept.password).toBe('OLD_CIPHER');
  });
  it('static → 空对象；sql → 内置连接标记', () => {
    expect(normalizeDatasourceConfig('static', {})).toEqual({});
    expect(normalizeDatasourceConfig('sql', {})).toEqual({ connection: 'internal' });
  });
});

describe('mapDatasource - DTO 脱敏', () => {
  it('API 敏感头掩码为 ******，非敏感保留', () => {
    const dto = mapDatasource(rowOf({ type: 'api', config: { url: 'https://x', method: 'GET', headers: { authorization: 'CIPHER', 'x-trace': 'abc' } } }));
    const cfg = dto.config as ReportApiDatasourceConfig;
    expect(cfg.headers!.authorization).toBe('******');
    expect(cfg.headers!['x-trace']).toBe('abc');
  });
  it('外部库去除 password，置 hasPassword 标记', () => {
    const dto = mapDatasource(rowOf({ type: 'mysql', config: { host: 'h', port: 3306, database: 'd', user: 'u', password: 'CIPHER' } }));
    const cfg = dto.config as ReportExternalDbConfig & { hasPassword?: boolean };
    expect(cfg.password).toBeNull();
    expect(cfg.hasPassword).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

type ConfigModule = typeof import('./config');

const ENV_KEYS = ['ZENITH_ROLES', 'WORKER_HEALTH_PORT', 'SHUTDOWN_GRACE_MS', 'STORAGE_SHARED', 'NODE_ENV'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;

/** 重新加载 config（模块在加载期解析环境变量）；process.exit 改为抛错以便断言 */
async function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<ConfigModule> {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`process.exit(${code})`); }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return import('./config');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const silentLog = { warn: vi.fn(), error: vi.fn() };

describe('ZENITH_ROLES 解析', () => {
  it('缺省按全部角色运行且标记为非显式；停机硬闸取 15s', async () => {
    const { config } = await loadConfig({ ZENITH_ROLES: undefined });
    expect(config.roles).toMatchObject({ api: true, worker: true, explicit: false, label: 'all', list: ['api', 'worker'] });
    expect(config.shutdownGraceMs).toBe(15_000);
    expect(config.workerHealthPort).toBe(3301);
    expect(config.storageShared).toBe(false);
  });

  it('all 与 api,worker 等价，且均为显式', async () => {
    const a = (await loadConfig({ ZENITH_ROLES: 'all' })).config.roles;
    const b = (await loadConfig({ ZENITH_ROLES: ' worker , API ' })).config.roles;
    expect(a).toEqual({ api: true, worker: true, explicit: true, list: ['api', 'worker'], label: 'all' });
    expect(b).toEqual(a);
  });

  it('纯 api 角色：不执行作业，停机硬闸 15s', async () => {
    const { config } = await loadConfig({ ZENITH_ROLES: 'api' });
    expect(config.roles).toMatchObject({ api: true, worker: false, label: 'api', list: ['api'] });
    expect(config.shutdownGraceMs).toBe(15_000);
  });

  it('纯 worker 角色：停机硬闸缺省 120s 以排空作业，可被 SHUTDOWN_GRACE_MS 覆盖', async () => {
    expect((await loadConfig({ ZENITH_ROLES: 'worker' })).config.shutdownGraceMs).toBe(120_000);
    expect((await loadConfig({ ZENITH_ROLES: 'worker', SHUTDOWN_GRACE_MS: '45000' })).config.shutdownGraceMs).toBe(45_000);
  });

  it('未知角色或 all 混用其他角色时拒绝启动', async () => {
    await expect(loadConfig({ ZENITH_ROLES: 'api,foo' })).rejects.toThrow('process.exit(1)');
    await expect(loadConfig({ ZENITH_ROLES: 'all,api' })).rejects.toThrow('process.exit(1)');
  });
});

describe('assertRuntimeRoles', () => {
  it('非开发环境未显式设置角色时终止进程', async () => {
    const { assertRuntimeRoles } = await loadConfig({ ZENITH_ROLES: undefined, NODE_ENV: 'production' });
    expect(() => assertRuntimeRoles(silentLog)).toThrow('process.exit(1)');
    expect(silentLog.error).toHaveBeenCalledWith(expect.stringContaining('ZENITH_ROLES'));
  });

  it('开发环境缺省只告警；显式设置时任何环境都放行', async () => {
    const dev = await loadConfig({ ZENITH_ROLES: undefined, NODE_ENV: 'development' });
    const log = { warn: vi.fn(), error: vi.fn() };
    expect(() => dev.assertRuntimeRoles(log)).not.toThrow();
    expect(log.warn).toHaveBeenCalledOnce();

    const prod = await loadConfig({ ZENITH_ROLES: 'api', NODE_ENV: 'production' });
    const quiet = { warn: vi.fn(), error: vi.fn() };
    expect(() => prod.assertRuntimeRoles(quiet)).not.toThrow();
    expect(quiet.warn).not.toHaveBeenCalled();
  });
});

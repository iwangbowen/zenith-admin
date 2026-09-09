import { describe, expect, it } from 'vitest';
import {
  buildPsqlLaunch,
  parseDbTerminalShellType,
} from './db-admin-terminal.service';

describe('parseDbTerminalShellType', () => {
  it('识别只读与读写标识', () => {
    expect(parseDbTerminalShellType('db-psql')).toBe('ro');
    expect(parseDbTerminalShellType('db-psql:rw')).toBe('rw');
  });

  it('其余 shell 类型返回 null', () => {
    expect(parseDbTerminalShellType(undefined)).toBeNull();
    expect(parseDbTerminalShellType('bash')).toBeNull();
    expect(parseDbTerminalShellType('db-psql:ro:extra')).toBeNull();
    expect(parseDbTerminalShellType('docker-exec:abc:sh')).toBeNull();
  });
});

describe('buildPsqlLaunch', () => {
  const params = {
    host: 'localhost', port: '5432', user: 'postgres', password: 'pw',
    database: 'zenith_admin', sslMode: null,
  };

  it('凭据只进环境变量，不进程序参数', () => {
    const launch = buildPsqlLaunch('rw', 'psql', params);
    expect(launch.args).toEqual(['-h', 'localhost', '-p', '5432', '-U', 'postgres', '-d', 'zenith_admin']);
    expect(launch.args.join(' ')).not.toContain('pw');
    expect(launch.env.PGPASSWORD).toBe('pw');
    expect(launch.env.PGCLIENTENCODING).toBe('UTF8');
  });

  it('只读模式注入 default_transaction_read_only，角色可用时同时切换到只读角色', () => {
    expect(buildPsqlLaunch('ro', 'psql', params).env.PGOPTIONS).toBe('-c default_transaction_read_only=on');
    expect(buildPsqlLaunch('ro', 'psql', params, { readonlyRole: true }).env.PGOPTIONS)
      .toBe('-c default_transaction_read_only=on -c role=zenith_readonly');
    expect(buildPsqlLaunch('rw', 'psql', params).env.PGOPTIONS).toBeUndefined();
    expect(buildPsqlLaunch('rw', 'psql', params, { readonlyRole: true }).env.PGOPTIONS).toBeUndefined();
  });

  it('标签区分只读与读写', () => {
    expect(buildPsqlLaunch('ro', 'psql', params).label).toBe('psql:zenith_admin · 只读');
    expect(buildPsqlLaunch('rw', 'psql', params).label).toBe('psql:zenith_admin · 读写');
  });

  it('连接串 sslmode 优先生效', () => {
    expect(buildPsqlLaunch('ro', 'psql', { ...params, sslMode: 'require' }).env.PGSSLMODE).toBe('require');
  });
});

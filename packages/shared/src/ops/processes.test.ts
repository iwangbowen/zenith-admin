import { describe, expect, it } from 'vitest';
import { matchesProcessFilter } from './processes';

const proc = (pid: number, name: string, user: string, status: string, command = name) => ({ pid, name, user, status, command });

describe('matchesProcessFilter', () => {
  const list = [
    proc(1, 'systemd', 'root', 'sleeping', '/sbin/init'),
    proc(1234, 'node', 'app', 'running', 'node dist/index.js'),
    proc(4321, 'Postgres', 'postgres', 'sleeping'),
  ];

  it('关键字大小写不敏感，匹配进程名 / 命令 / 用户 / PID；首尾空白忽略', () => {
    expect(list.filter((p) => matchesProcessFilter(p, { keyword: ' NODE ' })).map((p) => p.pid)).toEqual([1234]);
    expect(list.filter((p) => matchesProcessFilter(p, { keyword: 'init' })).map((p) => p.pid)).toEqual([1]);
    expect(list.filter((p) => matchesProcessFilter(p, { keyword: 'postgres' })).map((p) => p.pid)).toEqual([4321]);
    expect(list.filter((p) => matchesProcessFilter(p, { keyword: '32' })).map((p) => p.pid)).toEqual([4321]);
  });

  it('状态精确匹配，可与关键字叠加；空条件全部命中', () => {
    expect(list.filter((p) => matchesProcessFilter(p, { status: 'sleeping' })).map((p) => p.pid)).toEqual([1, 4321]);
    expect(list.filter((p) => matchesProcessFilter(p, { status: 'sleeping', keyword: 'postgres' })).map((p) => p.pid)).toEqual([4321]);
    expect(list.filter((p) => matchesProcessFilter(p, {}))).toHaveLength(3);
    expect(list.filter((p) => matchesProcessFilter(p, { keyword: '', status: undefined }))).toHaveLength(3);
  });
});

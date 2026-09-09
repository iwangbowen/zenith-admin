import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-logviewer-'));
const logDir = path.join(tmpRoot, 'logs');
const extraRoot = path.join(tmpRoot, 'var-log');
const outside = path.join(tmpRoot, 'secret.env');

vi.mock('../../config', () => ({
  config: { log: { dir: logDir, viewerRoots: [extraRoot, '/var/log'] } },
}));
const remoteExec = vi.fn();
const remoteExecStream = vi.fn();
vi.mock('../../lib/host-exec', () => ({
  getRemoteExecutor: vi.fn(),
  resolveExecutor: vi.fn(async () => ({ hostId: 7, isRemote: true, exec: remoteExec, execStream: remoteExecStream })),
}));

const {
  resolveAllowedLogPath, getLocalLogRoots, getRemoteLogRoots, readLastLines, followLogLines, assertTailable,
} = await import('./log-viewer.service');

beforeAll(() => {
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(extraRoot, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'app.log'), 'hello\n[error] boom\n\nworld\n');
  fs.writeFileSync(path.join(extraRoot, 'syslog'), 'sys\n');
  fs.writeFileSync(outside, 'SECRET=1\n');
  try {
    fs.symlinkSync(outside, path.join(logDir, 'escape.log'));
  } catch { /* 无符号链接权限时跳过对应断言 */ }
});
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('日志查看器目录白名单（M4）', () => {
  it('白名单包含应用日志目录与配置目录', () => {
    expect(getLocalLogRoots()).toEqual(expect.arrayContaining([path.resolve(logDir), path.resolve(extraRoot)]));
    // 远端白名单只取 POSIX 绝对路径（Linux 下临时目录也以 / 开头，因此这里用包含判断）
    expect(getRemoteLogRoots()).toContain('/var/log');
    expect(getRemoteLogRoots().every((r) => r.startsWith('/'))).toBe(true);
  });

  it('允许白名单内的常规文件，返回真实路径', async () => {
    await expect(resolveAllowedLogPath(path.join(logDir, 'app.log'))).resolves.toBe(fs.realpathSync(path.join(logDir, 'app.log')));
    await expect(resolveAllowedLogPath(path.join(extraRoot, 'syslog'))).resolves.toBe(fs.realpathSync(path.join(extraRoot, 'syslog')));
  });

  it('拒绝白名单外的文件、路径穿越与相对路径', async () => {
    await expect(resolveAllowedLogPath(outside)).rejects.toMatchObject({ status: 403 });
    await expect(resolveAllowedLogPath(path.join(logDir, '..', 'secret.env'))).rejects.toMatchObject({ status: 403 });
    await expect(resolveAllowedLogPath('logs/app.log')).rejects.toMatchObject({ status: 400 });
    await expect(resolveAllowedLogPath(path.join(tmpRoot, 'nope', 'x.log'))).rejects.toMatchObject({ status: 403 });
  });

  it('白名单内不存在的文件返回 404，目录返回 400', async () => {
    await expect(resolveAllowedLogPath(path.join(logDir, 'missing.log'))).rejects.toMatchObject({ status: 404 });
    await expect(resolveAllowedLogPath(logDir)).rejects.toMatchObject({ status: 400 });
  });

  it('符号链接指向白名单外时被拒绝（按 realpath 判定）', async () => {
    if (!fs.existsSync(path.join(logDir, 'escape.log'))) return;
    await expect(resolveAllowedLogPath(path.join(logDir, 'escape.log'))).rejects.toMatchObject({ status: 403 });
  });

  it('远端路径按 POSIX 规范化后必须落在 LOG_VIEWER_ROOTS 内', async () => {
    await expect(resolveAllowedLogPath('/var/log/nginx/access.log', 7)).resolves.toBe('/var/log/nginx/access.log');
    await expect(resolveAllowedLogPath('/var/log/../../etc/shadow', 7)).rejects.toMatchObject({ status: 403 });
    await expect(resolveAllowedLogPath('/etc/shadow', 7)).rejects.toMatchObject({ status: 403 });
    await expect(resolveAllowedLogPath('/var/logs/x', 7)).rejects.toMatchObject({ status: 403 });
    await expect(resolveAllowedLogPath('var/log/syslog', 7)).rejects.toMatchObject({ status: 400 });
  });
});

describe('日志查看器读取内核', () => {
  const appLog = path.join(logDir, 'app.log');

  it('本机读取返回末尾 N 行（跳过空行），支持关键词过滤', async () => {
    await expect(readLastLines(appLog, 2)).resolves.toEqual(['[error] boom', 'world']);
    await expect(readLastLines(appLog, 10, null, { keyword: 'BOOM' })).resolves.toEqual(['[error] boom']);
  });

  it('远端普通文件用 tail -n 读取并按行返回', async () => {
    remoteExec.mockResolvedValueOnce({ stdout: 'a\r\nb\n\nc\n', stderr: '' });
    await expect(readLastLines('/var/log/syslog', 3, 7)).resolves.toEqual(['a', 'b', 'c']);
    expect(remoteExec).toHaveBeenLastCalledWith('tail', ['-n', '3', '--', '/var/log/syslog'], expect.any(Object));
  });

  it('远端关键词过滤走 sh 管道，关键词经位置参数传递并剔除 grep 分组分隔行', async () => {
    remoteExec.mockResolvedValueOnce({ stdout: 'ctx-1\nhit one\n--\nhit two\n', stderr: '' });
    const lines = await readLastLines('/var/log/syslog', 100, 7, { keyword: "hit'; rm -rf /", context: 1 });
    expect(lines).toEqual(['ctx-1', 'hit one', 'hit two']);
    const [file, args] = remoteExec.mock.calls.at(-1) as [string, string[]];
    expect(file).toBe('sh');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain('grep -i -F -C "$3" -e "$2"');
    expect(args.slice(2)).toEqual(['sh', '/var/log/syslog', "hit'; rm -rf /", '1', '100']);
  });

  it('远端 gzip 归档先解压再截断', async () => {
    remoteExec.mockResolvedValueOnce({ stdout: 'z\n', stderr: '' });
    await expect(readLastLines('/var/log/syslog.1.gz', 5, 7)).resolves.toEqual(['z']);
    const [, args] = remoteExec.mock.calls.at(-1) as [string, string[]];
    expect(args[1]).toContain('gzip -dc -- "$1"');
    expect(args[1]).not.toContain('grep');
  });

  it('压缩归档不允许实时追踪', () => {
    expect(() => assertTailable('/var/log/x.log.gz')).toThrow();
    expect(() => assertTailable('/var/log/x.log')).not.toThrow();
  });

  it('远端实时追踪把分块输出拆成整行推送，中止时终止进程', async () => {
    const kill = vi.fn();
    let onData!: (chunk: string) => void;
    remoteExecStream.mockImplementationOnce(async (_file: string, _args: string[], opts: { onData: (c: string) => void }) => {
      onData = opts.onData;
      return { kill };
    });
    const ctrl = new AbortController();
    const received: string[][] = [];
    const done = followLogLines('/var/log/syslog', 7, ctrl.signal, async (lines) => { received.push(lines); });
    await vi.waitFor(() => expect(remoteExecStream).toHaveBeenCalled());
    onData('partial');
    onData(' line\nsecond\n');
    await vi.waitFor(() => expect(received).toEqual([['partial line', 'second']]));
    ctrl.abort();
    await done;
    expect(kill).toHaveBeenCalled();
    expect(remoteExecStream).toHaveBeenLastCalledWith('tail', ['-f', '-n', '0', '--', '/var/log/syslog'], expect.any(Object));
  });

  it('本机实时追踪按文件增长推送新增行', async () => {
    const file = path.join(logDir, 'grow.log');
    fs.writeFileSync(file, 'old\n');
    const ctrl = new AbortController();
    const received: string[][] = [];
    const done = followLogLines(file, null, ctrl.signal, async (lines) => {
      received.push(lines);
      ctrl.abort();
    });
    // 等待首次 stat 完成后再追加，避免追加内容被计入初始位置
    await new Promise((r) => setTimeout(r, 50));
    fs.appendFileSync(file, 'fresh\n');
    await done;
    expect(received).toEqual([['fresh']]);
  });
});

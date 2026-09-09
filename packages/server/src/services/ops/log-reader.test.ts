import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TailRingBuffer, collectTailLines, createLineSplitter, readTailLinesStream, splitLogLines, watchTail } from './log-reader';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-logreader-'));
const plainFile = path.join(tmpRoot, 'app.log');
const gzFile = path.join(tmpRoot, 'app.1.log.gz');

const LINES = ['[info] boot', '[warn] slow query', '', '[error] boom', '  at fn (a.ts:1)', '[info] recovered'];

beforeAll(() => {
  fs.writeFileSync(plainFile, `${LINES.join('\n')}\n`);
  fs.writeFileSync(gzFile, zlib.gzipSync(`${LINES.join('\r\n')}\r\n`));
});
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('TailRingBuffer', () => {
  it('只保留最后 N 项并按写入顺序输出', () => {
    const ring = new TailRingBuffer(3);
    for (const v of ['a', 'b', 'c', 'd', 'e']) ring.push(v);
    expect(ring.toArray()).toEqual(['c', 'd', 'e']);
  });

  it('未填满时按实际数量输出', () => {
    const ring = new TailRingBuffer(3);
    ring.push('a');
    expect(ring.toArray()).toEqual(['a']);
  });
});

describe('collectTailLines', () => {
  it('跳过空行并取末尾 N 行', async () => {
    await expect(collectTailLines(LINES, 2)).resolves.toEqual(['  at fn (a.ts:1)', '[info] recovered']);
  });

  it('关键词大小写不敏感过滤，无上下文时只保留命中行', async () => {
    await expect(collectTailLines(LINES, 10, { keyword: 'INFO' })).resolves.toEqual(['[info] boot', '[info] recovered']);
  });

  it('上下文行围绕命中行保留，且不重复', async () => {
    await expect(collectTailLines(LINES, 10, { keyword: 'boom', context: 1 })).resolves.toEqual([
      '[warn] slow query', '[error] boom', '  at fn (a.ts:1)',
    ]);
  });

  it('空白关键词等同不过滤', async () => {
    await expect(collectTailLines(LINES, 10, { keyword: '   ' })).resolves.toHaveLength(5);
  });

  it('接受异步可迭代源', async () => {
    async function* gen() {
      yield 'x';
      yield 'y';
    }
    await expect(collectTailLines(gen(), 5)).resolves.toEqual(['x', 'y']);
  });
});

describe('readTailLinesStream', () => {
  it('普通文本文件按行读取末尾 N 行', async () => {
    await expect(readTailLinesStream(plainFile, 2)).resolves.toEqual(['  at fn (a.ts:1)', '[info] recovered']);
  });

  it('gzip 归档解压后读取，CRLF 同样按行切分', async () => {
    await expect(readTailLinesStream(gzFile, 3)).resolves.toEqual(['[error] boom', '  at fn (a.ts:1)', '[info] recovered']);
    await expect(readTailLinesStream(gzFile, 10, { keyword: 'warn' })).resolves.toEqual(['[warn] slow query']);
  });
});

describe('splitLogLines / createLineSplitter', () => {
  it('splitLogLines 兼容 CRLF 并丢弃空行', () => {
    expect(splitLogLines('a\r\nb\n\n c \n')).toEqual(['a', 'b', ' c ']);
  });

  it('行切分器把跨块的半行拼回整行，flush 吐出残余', () => {
    const batches: string[][] = [];
    const splitter = createLineSplitter((lines) => batches.push(lines));
    splitter.push('first li');
    splitter.push('ne\nsecond\nthi');
    splitter.push('rd');
    expect(batches).toEqual([['first line', 'second']]);
    splitter.flush();
    expect(batches).toEqual([['first line', 'second'], ['third']]);
    splitter.flush();
    expect(batches).toHaveLength(2);
  });
});

describe('watchTail', () => {
  it('推送文件新增行并在 signal 中止后结束', async () => {
    const file = path.join(tmpRoot, 'grow.log');
    fs.writeFileSync(file, 'old\n');
    const received: string[][] = [];
    const ctrl = new AbortController();
    const done = watchTail(file, ctrl.signal, fs.statSync(file).size, async (lines) => {
      received.push(lines);
      ctrl.abort();
    });
    fs.appendFileSync(file, 'new-1\nnew-2\n');
    await done;
    expect(received).toEqual([['new-1', 'new-2']]);
  });

  it('文件被删除时自行结束', async () => {
    const file = path.join(tmpRoot, 'gone.log');
    fs.writeFileSync(file, '');
    const ctrl = new AbortController();
    const done = watchTail(file, ctrl.signal, 0, async () => {});
    fs.rmSync(file);
    await expect(done).resolves.toBeUndefined();
  });
});

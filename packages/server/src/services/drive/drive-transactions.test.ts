/**
 * 架构约束：持有 `db.transaction` 期间不得调用运行时设置读取（`getSettings` / `getDriveSettings` / `getWikiSettings` /
 * `getIdentitySecurityPolicy`）。
 *
 * 设置命中副本时零查询，但冷加载会向**全局连接池**借连接；事务已各自占住一条连接，
 * 并发事务数 ≥ 连接池上限时，事务内的冷加载永远拿不到连接 → 整个池死锁（曾出现在网盘覆盖上传：
 * 一次事务内 39 条设置查询）。正确写法：事务外读取后作为参数传入。
 *
 * 本测试对 services / lib 源码做静态扫描：定位每个 `transaction(` 调用，取其配平括号内的回调体，断言其中不含设置读取。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [join(import.meta.dirname, '..'), join(import.meta.dirname, '..', '..', 'lib')];
const FORBIDDEN = /\b(getSettings|getDriveSettings|getWikiSettings|getIdentitySecurityPolicy)\s*\(/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) yield full;
  }
}

/** 从 `transaction(` 之后取配平括号的完整实参文本（含回调体） */
function transactionBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /\.transaction\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    bodies.push(source.slice(start, i - 1));
  }
  return bodies;
}

describe('事务内禁止读取运行时设置', () => {
  it('services / lib 中所有 transaction 回调体都不调用 getSettings 系列函数', () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('.transaction(')) continue;
        for (const body of transactionBodies(source)) {
          scanned += 1;
          const hit = FORBIDDEN.exec(body);
          if (hit) violations.push(`${relative(join(import.meta.dirname, '..', '..'), file)} → ${hit[1]}()`);
        }
      }
    }
    // 扫描器自检：仓库里事务用法众多，扫不到说明路径或正则失效
    expect(scanned).toBeGreaterThan(50);
    expect(violations, '在事务外读取设置并以参数传入（见 drive-upload.service appendVersion 的 settings 形参）').toEqual([]);
  });
});

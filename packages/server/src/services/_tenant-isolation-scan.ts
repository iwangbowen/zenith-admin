import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * 租户隔离静态扫描（供 `tenant-isolation.test.ts` 与基线生成共用）。
 *
 * 规则：对带 `tenantId` 列的表，按「请求侧 id」（函数入参 id / xxxId / ids，或 input / query / body 等入参对象的属性）
 * 做 `select / update / delete … .where(eq|inArray(T.id, …))` 时，所在函数（含同文件顶层辅助函数一层展开）必须满足其一：
 * - 同一函数内对该表叠加了租户条件：`tenantScope(T)` / `tenantCondition(T, …)` / `T.tenantId` / 领域 `xxxScopedWhere(T, …)`；
 * - 走 `defineCrudService` 产物：`xxxService.whereId | ensure | scope | get | update | remove(…)`；
 * - 对同一 id 调用了 `ensure* / assert* / require* / check* / load* / verify* / authorize* / resolve* / getOwn* / *Or404 / *ForUpdate`
 *   形态的校验函数（守卫由被调函数负责，被调函数自身另行扫描）；
 * - 按归属用户校验：`eq(T.userId | ownerId | createdBy | consulteeId | principalId, …)` 或 `.userId !== ` 一类比较。
 */

export interface TenantIsolationFinding {
  /** 相对 `src` 的路径 */
  readonly file: string;
  readonly fn: string;
  readonly table: string;
  readonly line: number;
  readonly value: string;
}

const SRC = join(__dirname, '..');
const SCHEMA_DIR = join(SRC, 'db/schema');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `db/schema` 中带 `tenantId` 列的表变量名 */
export function loadTenantTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of listFiles(SCHEMA_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/export const (\w+) = pgTable\(\s*'[^']*'\s*,\s*\{/g)) {
      let i = m.index! + m[0].length;
      let depth = 1;
      const start = i;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
      }
      if (/^\s*tenantId\s*:/m.test(src.slice(start, i - 1))) tables.add(m[1]);
    }
  }
  return tables;
}

const text = (n: ts.Node, src: string) => src.slice(n.getStart(), n.getEnd());

/** where(...) 所在链式调用的根表：db.select().from(T) / db.update(T) / db.delete(T) */
function rootTable(whereCall: ts.CallExpression): string | null {
  let node: ts.Node | null = ts.isPropertyAccessExpression(whereCall.expression) ? whereCall.expression.expression : null;
  while (node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === 'from' || name === 'update' || name === 'delete') {
        const arg = node.arguments[0];
        return arg && ts.isIdentifier(arg) ? arg.text : null;
      }
      node = node.expression.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(node)) {
      node = node.expression;
      continue;
    }
    return null;
  }
  return null;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  let n: ts.Node | undefined = node.parent;
  while (n && !ts.isFunctionLike(n)) n = n.parent;
  return (n as ts.SignatureDeclaration | undefined) ?? null;
}

function functionName(fn: ts.SignatureDeclaration | null): string {
  if (!fn) return '(module)';
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if (fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  return '(anonymous)';
}

/** 入参名 → 类型标注文本 */
function paramInfo(fn: ts.SignatureDeclaration | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!fn) return map;
  for (const p of fn.parameters) {
    const typeText = p.type ? p.type.getText() : '';
    if (ts.isIdentifier(p.name)) map.set(p.name.text, typeText);
    else if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) if (ts.isIdentifier(el.name)) map.set(el.name.text, typeText);
    }
  }
  return map;
}

const INPUT_TYPE_RE = /Input\b|Query\b|Body\b|Payload\b|Params\b|QueryOutputOf|BodyOutputOf|z\.(infer|output)|Dto\b|Options\b/;
const INPUT_NAME_RE = /^(input|data|q|query|body|payload|params|dto|patch|opts|options|filters?)$/;
const ROW_TYPE_RE = /Row\b|\$inferSelect|Entity\b|Session\b|Node\b|Share\b|Job\b|Rule\b|Snapshot\b|Context\b|Record<|Map<|Set</;

/** 是否为「请求侧 id」：原始类型入参（id / xxxId / ids），或入参对象（input / query / body …）的属性 */
function isRequestSideValue(expr: ts.Expression, params: Map<string, string>): boolean {
  if (ts.isIdentifier(expr)) {
    const t = params.get(expr.text);
    if (t === undefined) return false;
    return !ROW_TYPE_RE.test(t) && (t === '' || /\b(number|string)\b|\[\]/.test(t)) && !INPUT_NAME_RE.test(expr.text);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    let n: ts.Expression = expr;
    while (ts.isPropertyAccessExpression(n)) n = n.expression;
    if (!ts.isIdentifier(n)) return false;
    const t = params.get(n.text);
    if (t === undefined) return false;
    return INPUT_NAME_RE.test(n.text) || INPUT_TYPE_RE.test(t);
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'Number' && expr.arguments[0]) {
    return isRequestSideValue(expr.arguments[0], params);
  }
  return false;
}

/** 表达式里的 eq / inArray(T.id, X) → X */
function idFilters(exprNode: ts.Node, table: string): ts.Expression[] {
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'eq' || n.expression.text === 'inArray') && n.arguments.length === 2) {
      const a = n.arguments[0];
      if (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === table && a.name.text === 'id') out.push(n.arguments[1]);
    }
    ts.forEachChild(n, visit);
  };
  visit(exprNode);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function bodyHasGuard(fnText: string, table: string, idText: string): boolean {
  const t = escapeRe(table);
  if (table === 'asyncTasks' && /\basyncTaskScopedWhere\(/.test(fnText)) return true;
  if (new RegExp(`tenantScope\\(\\s*${t}\\s*\\)|tenantCondition\\(\\s*${t}\\s*,|\\b${t}\\.tenantId\\b|ScopedWhere\\(\\s*${t}\\b|scopedWhere\\(\\s*${t}\\b`).test(fnText)) return true;
  if (/\.(whereId|ensure|scope)\(/.test(fnText) || /Service\.(get|update|remove|removeMany)\(/.test(fnText)) return true;
  if (new RegExp(`\\b${t}\\.(userId|ownerId|createdBy|consulteeId|principalId|memberId)\\b`).test(fnText) || /\.(userId|ownerId|createdBy|consulteeId|principalId) !==? /.test(fnText)) return true;
  const idEsc = escapeRe(idText);
  return new RegExp(`\\b(ensure|assert|require|check|load|verify|authorize|resolve|getOwn|get[A-Za-z0-9_]*Or404|get[A-Za-z0-9_]*ForUpdate)[A-Za-z0-9_]*\\(\\s*(?:[^()]*,\\s*)?${idEsc}\\s*[,)]`).test(fnText);
}

function localInit(name: string, fn: ts.Node | null): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      found = n.initializer;
      return;
    }
    ts.forEachChild(n, visit);
  };
  if (fn) visit(fn);
  return found;
}

export function scanTenantIsolation(): TenantIsolationFinding[] {
  const tenantTables = loadTenantTables();
  const findings: TenantIsolationFinding[] = [];
  const files = [...listFiles(join(SRC, 'services')), ...listFiles(join(SRC, 'routes'))];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('.where(') && !src.includes('.findFirst(') && !src.includes('.findMany(')) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const rel = relative(SRC, file).replace(/\\/g, '/');

    const topFns = new Map<string, ts.Node>();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) topFns.set(st.name.text, st);
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && ts.isFunctionLike(d.initializer)) topFns.set(d.name.text, d.initializer);
        }
      }
    }

    const visit = (node: ts.Node) => {
      let table: string | null = null;
      let whereArg: ts.Node | null = null;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        if (callee.name.text === 'where' && node.arguments.length === 1) {
          table = rootTable(node);
          whereArg = node.arguments[0];
        } else if ((callee.name.text === 'findFirst' || callee.name.text === 'findMany') && ts.isPropertyAccessExpression(callee.expression)
          && ts.isPropertyAccessExpression(callee.expression.expression) && callee.expression.expression.name.text === 'query') {
          // 关系查询 API：db.query.<table>.findFirst({ where })
          table = callee.expression.name.text;
          const arg = node.arguments[0];
          if (arg && ts.isObjectLiteralExpression(arg)) {
            const whereProp = arg.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'where');
            whereArg = whereProp && ts.isPropertyAssignment(whereProp) ? whereProp.initializer : null;
          }
        }
      }
      if (table && whereArg && tenantTables.has(table)) {
        const fn = enclosingFunction(node);
        const params = paramInfo(fn);
        const nodes: ts.Node[] = [whereArg];
        if (ts.isIdentifier(whereArg)) {
          const init = localInit(whereArg.text, fn);
          if (init) nodes.push(init);
        }
        const risky = nodes.flatMap((n) => idFilters(n, table!)).filter((x) => isRequestSideValue(x, params));
        if (risky.length) {
          let scopeText = fn ? text(fn, src) : text(node, src);
          const called = new Set([...scopeText.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
          for (const name of called) {
            const target = topFns.get(name);
            if (target && target !== fn) scopeText += `\n${text(target, src)}`;
          }
          const value = text(risky[0], src);
          if (!bodyHasGuard(scopeText, table, value)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            findings.push({ file: rel, fn: functionName(fn), table, line: line + 1, value });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

export const findingKey = (f: Pick<TenantIsolationFinding, 'file' | 'fn' | 'table'>) => `${f.file} :: ${f.fn} :: ${f.table}`;

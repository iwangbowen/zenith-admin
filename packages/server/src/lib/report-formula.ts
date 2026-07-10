/**
 * 报表计算字段安全表达式求值器。
 * 纯解析执行（无 eval / new Function），仅支持白名单运算与函数，
 * 标识符解析为当前行的列值。供数据集衍生列在取数后逐行计算。
 *
 * 支持：数字/字符串字面量、列引用、( ) 、一元 - !、
 *       * / % 、+ - 、比较 > < >= <= == != 、&& 、|| 、三元 ?: 、
 *       函数：round floor ceil abs min max sqrt pow
 *             concat upper lower trim length substr
 *             number string coalesce ifnull if now
 */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punc'; v: string };

const OPS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '+', '-', '*', '/', '%', '!'];

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    // string
    if (ch === '"' || ch === "'") {
      const quote = ch; let j = i + 1; let s = '';
      while (j < n && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < n) { s += input[j + 1]; j += 2; } else { s += input[j]; j++; }
      }
      if (j >= n) throw new Error('字符串字面量未闭合');
      toks.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    // number
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i; while (j < n && /[0-9.]/.test(input[j])) j++;
      toks.push({ t: 'num', v: Number(input.slice(i, j)) }); i = j; continue;
    }
    // identifier (column / function / true/false/null)
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
      let j = i; while (j < n && /[A-Za-z0-9_\u4e00-\u9fa5.]/.test(input[j])) j++;
      toks.push({ t: 'id', v: input.slice(i, j) }); i = j; continue;
    }
    // punctuation
    if (ch === '(' || ch === ')' || ch === ',' || ch === '?' || ch === ':') {
      toks.push({ t: 'punc', v: ch }); i++; continue;
    }
    // operator (longest match)
    const op = OPS.find((o) => input.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue; }
    throw new Error(`无法识别的字符：${ch}`);
  }
  return toks;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'col'; name: string }
  | { k: 'unary'; op: string; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

// 优先级（数值越大越紧）
const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3, '>': 3, '<': 3, '>=': 3, '<=': 3,
  '+': 4, '-': 4, '*': 5, '/': 5, '%': 5,
};

function parse(toks: Tok[]): Node {
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok | undefined => toks[pos++];

  function parsePrimary(): Node {
    const tk = next();
    if (!tk) throw new Error('表达式意外结束');
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'str') return { k: 'str', v: tk.v };
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '!')) return { k: 'unary', op: tk.v, e: parsePrimary() };
    if (tk.t === 'punc' && tk.v === '(') {
      const e = parseExpr(0);
      const close = next();
      if (!close || close.t !== 'punc' || close.v !== ')') throw new Error('缺少右括号');
      return e;
    }
    if (tk.t === 'id') {
      const low = tk.v.toLowerCase();
      if (low === 'true') return { k: 'bool', v: true };
      if (low === 'false') return { k: 'bool', v: false };
      if (low === 'null') return { k: 'null' };
      // function call?
      if (peek() && peek()!.t === 'punc' && peek()!.v === '(') {
        next(); // consume (
        const args: Node[] = [];
        if (!(peek() && peek()!.t === 'punc' && peek()!.v === ')')) {
          for (;;) {
            args.push(parseExpr(0));
            const sep = peek();
            if (sep && sep.t === 'punc' && sep.v === ',') { next(); continue; }
            break;
          }
        }
        const close = next();
        if (!close || close.t !== 'punc' || close.v !== ')') throw new Error('函数缺少右括号');
        return { k: 'call', name: low, args };
      }
      return { k: 'col', name: tk.v };
    }
    throw new Error(`意外的标记：${String(tk.v)}`);
  }

  function parseExpr(minPrec: number): Node {
    let left = parsePrimary();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op') break;
      const prec = BIN_PREC[tk.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = parseExpr(prec + 1);
      left = { k: 'bin', op: tk.v, l: left, r: right };
    }
    // ternary
    const q = peek();
    if (q && q.t === 'punc' && q.v === '?' && minPrec === 0) {
      next();
      const a = parseExpr(0);
      const colon = next();
      if (!colon || colon.t !== 'punc' || colon.v !== ':') throw new Error('三元表达式缺少 :');
      const b = parseExpr(0);
      return { k: 'tern', c: left, a, b };
    }
    return left;
  }

  const node = parseExpr(0);
  if (pos !== toks.length) throw new Error('表达式存在多余内容');
  return node;
}

function toNum(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function toStr(v: unknown): string { return v === null || v === undefined ? '' : String(v); }

const FUNCS: Record<string, (args: unknown[]) => unknown> = {
  round: (a) => { const d = a[1] !== undefined ? toNum(a[1]) : 0; const f = 10 ** d; return Math.round(toNum(a[0]) * f) / f; },
  floor: (a) => Math.floor(toNum(a[0])),
  ceil: (a) => Math.ceil(toNum(a[0])),
  abs: (a) => Math.abs(toNum(a[0])),
  sqrt: (a) => Math.sqrt(toNum(a[0])),
  pow: (a) => Math.pow(toNum(a[0]), toNum(a[1])),
  min: (a) => Math.min(...a.map(toNum)),
  max: (a) => Math.max(...a.map(toNum)),
  number: (a) => toNum(a[0]),
  string: (a) => toStr(a[0]),
  concat: (a) => a.map(toStr).join(''),
  upper: (a) => toStr(a[0]).toUpperCase(),
  lower: (a) => toStr(a[0]).toLowerCase(),
  trim: (a) => toStr(a[0]).trim(),
  length: (a) => toStr(a[0]).length,
  substr: (a) => toStr(a[0]).substr(toNum(a[1]), a[2] !== undefined ? toNum(a[2]) : undefined),
  coalesce: (a) => a.find((x) => x !== null && x !== undefined && x !== '') ?? null,
  ifnull: (a) => (a[0] === null || a[0] === undefined || a[0] === '' ? a[1] : a[0]),
  if: (a) => (truthy(a[0]) ? a[1] : a[2] ?? null),
  now: () => Date.now(),
};

function truthy(v: unknown): boolean {
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return !!v;
}

function evalNode(node: Node, row: Record<string, unknown>): unknown {
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'bool': return node.v;
    case 'null': return null;
    case 'col': return row[node.name] ?? null;
    case 'unary': {
      const e = evalNode(node.e, row);
      return node.op === '-' ? -toNum(e) : !truthy(e);
    }
    case 'tern': return truthy(evalNode(node.c, row)) ? evalNode(node.a, row) : evalNode(node.b, row);
    case 'call': {
      const fn = FUNCS[node.name];
      if (!fn) throw new Error(`未知函数：${node.name}`);
      return fn(node.args.map((a) => evalNode(a, row)));
    }
    case 'bin': {
      const op = node.op;
      if (op === '&&') return truthy(evalNode(node.l, row)) ? evalNode(node.r, row) : evalNode(node.l, row);
      if (op === '||') { const l = evalNode(node.l, row); return truthy(l) ? l : evalNode(node.r, row); }
      const l = evalNode(node.l, row); const r = evalNode(node.r, row);
      switch (op) {
        case '+': return (typeof l === 'string' || typeof r === 'string') ? toStr(l) + toStr(r) : toNum(l) + toNum(r);
        case '-': return toNum(l) - toNum(r);
        case '*': return toNum(l) * toNum(r);
        case '/': return toNum(l) / toNum(r);
        case '%': return toNum(l) % toNum(r);
        case '>': return toNum(l) > toNum(r);
        case '<': return toNum(l) < toNum(r);
        case '>=': return toNum(l) >= toNum(r);
        case '<=': return toNum(l) <= toNum(r);
        case '==': case '===': return l === r || toStr(l) === toStr(r);
        case '!=': case '!==': return !(l === r || toStr(l) === toStr(r));
        default: throw new Error(`未知运算符：${op}`);
      }
    }
  }
}

/** 编译表达式为求值函数；编译期语法错误抛出，便于保存前校验 */
export function compileFormula(expression: string): (row: Record<string, unknown>) => unknown {
  const ast = parse(tokenize(expression));
  return (row: Record<string, unknown>) => {
    try { return evalNode(ast, row); } catch { return null; }
  };
}

export interface ComputedFieldDef { name: string; expression: string; type?: 'string' | 'number' | 'date' | 'boolean' }

type DataResultLike = { columns: string[]; rows: Record<string, unknown>[]; total?: number | null; fields?: unknown };

/**
 * 对结果集应用计算字段（逐行追加列）。
 * 编译失败的字段被跳过（不影响其余取数），列名追加到 columns 末尾。
 */
export function applyComputedFields(
  result: DataResultLike,
  computed: ComputedFieldDef[] | null | undefined,
): DataResultLike {
  if (!computed || computed.length === 0) return result;
  const compiled: { name: string; fn: (row: Record<string, unknown>) => unknown; type?: string }[] = [];
  for (const c of computed) {
    if (!c.name || !c.expression) continue;
    try { compiled.push({ name: c.name, fn: compileFormula(c.expression), type: c.type }); } catch { /* 跳过非法表达式 */ }
  }
  if (compiled.length === 0) return result;
  const rows = result.rows.map((row) => {
    const next = { ...row };
    for (const c of compiled) {
      let v = c.fn(next);
      if (c.type === 'number' && v !== null && v !== undefined) { const n = Number(v); v = Number.isFinite(n) ? n : null; }
      next[c.name] = v as unknown;
    }
    return next;
  });
  const extraCols = compiled.map((c) => c.name).filter((name) => !result.columns.includes(name));
  return { columns: [...result.columns, ...extraCols], rows, total: result.total, ...(result.fields !== undefined ? { fields: result.fields } : {}) };
}

/** 校验表达式语法（保存前调用），返回错误信息或 null */
export function validateFormula(expression: string): string | null {
  try { parse(tokenize(expression)); return null; }
  catch (err) { return err instanceof Error ? err.message : '表达式语法错误'; }
}

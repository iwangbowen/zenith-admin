/**
 * 工作流安全表达式引擎。
 *
 * 取代「正则白名单 + new Function」的旧实现：用 jsep 把表达式解析为 AST，
 * 再用一个**仅支持纯函数子集**的解释器求值，从根本上杜绝任意代码执行（RCE）：
 * - 仅允许：字面量、标识符、成员/下标访问、数组、二元/逻辑/一元/三元运算
 * - 禁止：函数调用、赋值、逗号复合语句、this、模板串、原型链访问
 * - 标识符只能从显式传入的 scope 解析，无任何全局对象可达
 *
 * 同时提供 `validateExpression`：在设计器「发布前体检」阶段对表达式做
 * 语法 + 变量引用预校验，把错误定位到节点/字段。
 */
import jsep from 'jsep';

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

// 补充三等运算符，保证语义与 JS 一致。
jsep.addBinaryOp('===', 9);
jsep.addBinaryOp('!==', 9);

interface LiteralNode { type: 'Literal'; value: unknown }
interface IdentifierNode { type: 'Identifier'; name: string }
interface MemberNode { type: 'MemberExpression'; object: Node; property: Node; computed: boolean }
interface ArrayNode { type: 'ArrayExpression'; elements: Node[] }
interface UnaryNode { type: 'UnaryExpression'; operator: string; argument: Node }
interface BinaryNode { type: 'BinaryExpression'; operator: string; left: Node; right: Node }
interface LogicalNode { type: 'LogicalExpression'; operator: string; left: Node; right: Node }
interface ConditionalNode { type: 'ConditionalExpression'; test: Node; consequent: Node; alternate: Node }

type Node =
  | LiteralNode | IdentifierNode | MemberNode | ArrayNode
  | UnaryNode | BinaryNode | LogicalNode | ConditionalNode;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 解析表达式为 AST；失败抛 ExpressionError（带可读信息） */
export function parseExpression(expr: string): Node {
  const trimmed = (expr ?? '').trim();
  if (!trimmed) throw new ExpressionError('表达式为空');
  let ast: Node;
  try {
    ast = jsep(trimmed) as unknown as Node;
  } catch (err) {
    throw new ExpressionError(`语法错误：${(err as Error)?.message ?? String(err)}`);
  }
  assertSupported(ast);
  return ast;
}

/** 递归校验 AST 仅含受支持的纯函数子集节点 */
function assertSupported(node: Node): void {
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
      return;
    case 'MemberExpression':
      if (!node.computed && node.property.type === 'Identifier' && FORBIDDEN_KEYS.has(node.property.name)) {
        throw new ExpressionError(`禁止访问属性：${node.property.name}`);
      }
      assertSupported(node.object);
      assertSupported(node.property);
      return;
    case 'ArrayExpression':
      node.elements.forEach(assertSupported);
      return;
    case 'UnaryExpression':
      assertSupported(node.argument);
      return;
    case 'BinaryExpression':
    case 'LogicalExpression':
      assertSupported(node.left);
      assertSupported(node.right);
      return;
    case 'ConditionalExpression':
      assertSupported(node.test);
      assertSupported(node.consequent);
      assertSupported(node.alternate);
      return;
    default:
      // CallExpression / Compound / ThisExpression / 模板串 等一律拒绝
      throw new ExpressionError(`不支持的表达式语法：${(node as { type: string }).type}`);
  }
}

/** 解释执行 AST，标识符仅从 scope 解析（无全局可达） */
function evalNode(node: Node, scope: Record<string, unknown>): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      return scope[node.name];
    case 'MemberExpression': {
      const obj = evalNode(node.object, scope);
      if (obj == null) return undefined;
      const key = node.computed
        ? String(evalNode(node.property, scope))
        : (node.property.type === 'Identifier' ? node.property.name : '');
      if (FORBIDDEN_KEYS.has(key)) return undefined;
      return (obj as Record<string, unknown>)[key];
    }
    case 'ArrayExpression':
      return node.elements.map((e) => evalNode(e, scope));
    case 'UnaryExpression': {
      const v = evalNode(node.argument, scope) as never;
      switch (node.operator) {
        case '!': return !v;
        case '-': return -(v as number);
        case '+': return +(v as number);
        case '~': return ~(v as number);
        default: throw new ExpressionError(`不支持的一元运算符：${node.operator}`);
      }
    }
    case 'BinaryExpression': {
      // jsep 将 && / || 解析为 BinaryExpression：此处做短路求值，语义与 JS 一致
      if (node.operator === '&&') {
        const l = evalNode(node.left, scope);
        return l ? evalNode(node.right, scope) : l;
      }
      if (node.operator === '||') {
        const l = evalNode(node.left, scope);
        return l ? l : evalNode(node.right, scope);
      }
      const l = evalNode(node.left, scope) as never;
      const r = evalNode(node.right, scope) as never;
      switch (node.operator) {
        case '+': return (l as number) + (r as number);
        case '-': return (l as number) - (r as number);
        case '*': return (l as number) * (r as number);
        case '/': return (l as number) / (r as number);
        case '%': return (l as number) % (r as number);
        case '==': return l == r;
        case '!=': return l != r;
        case '===': return l === r;
        case '!==': return l !== r;
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
        case '&': return (l as number) & (r as number);
        case '|': return (l as number) | (r as number);
        case '^': return (l as number) ^ (r as number);
        default: throw new ExpressionError(`不支持的二元运算符：${node.operator}`);
      }
    }
    case 'LogicalExpression': {
      const l = evalNode(node.left, scope);
      if (node.operator === '&&') return l ? evalNode(node.right, scope) : l;
      if (node.operator === '||') return l ? l : evalNode(node.right, scope);
      throw new ExpressionError(`不支持的逻辑运算符：${node.operator}`);
    }
    case 'ConditionalExpression':
      return evalNode(node.test, scope) ? evalNode(node.consequent, scope) : evalNode(node.alternate, scope);
    default:
      throw new ExpressionError(`不支持的表达式语法：${(node as { type: string }).type}`);
  }
}

/** 安全求值：解析 + 校验 + 解释执行（解析结果走 LRU 缓存，条件求值高频复用同一表达式） */
export function evaluateExpression(expr: string, scope: Record<string, unknown>): unknown {
  return evalNode(parseExpressionCached(expr), scope);
}

// ─── AST LRU 缓存：网关条件/公式在每次推进时重复求值，避免重复 parse ───
const AST_CACHE_MAX = 500;
const astCache = new Map<string, Node>();

function parseExpressionCached(expr: string): Node {
  const key = (expr ?? '').trim();
  const hit = astCache.get(key);
  if (hit) {
    // Map 按插入序迭代：删除后重插实现 LRU 触达提升
    astCache.delete(key);
    astCache.set(key, hit);
    return hit;
  }
  const ast = parseExpression(expr);
  if (astCache.size >= AST_CACHE_MAX) {
    const oldest = astCache.keys().next().value;
    if (oldest !== undefined) astCache.delete(oldest);
  }
  astCache.set(key, ast);
  return ast;
}

/** 收集表达式引用到的成员路径（如 `form.amount`、`starter.id`）与根标识符 */
export function collectReferences(ast: Node): { paths: string[]; roots: string[] } {
  const paths = new Set<string>();
  const roots = new Set<string>();

  const addPath = (p: string): void => {
    paths.add(p);
    roots.add(p.split('.')[0]);
  };

  const memberPath = (node: Node): string | null => {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression') {
      const base = memberPath(node.object);
      if (base == null) {
        walk(node.object);
        if (node.computed) walk(node.property);
        return null;
      }
      if (node.computed) {
        // 动态下标：path 止于 base，base 记为引用，下标变量继续 walk
        if (node.property.type === 'Literal') return `${base}.${String(node.property.value)}`;
        addPath(base);
        walk(node.property);
        return null;
      }
      return node.property.type === 'Identifier' ? `${base}.${node.property.name}` : base;
    }
    walk(node);
    return null;
  };

  const walk = (node: Node): void => {
    switch (node.type) {
      case 'Identifier':
        addPath(node.name);
        return;
      case 'MemberExpression': {
        const p = memberPath(node);
        if (p) addPath(p);
        return;
      }
      case 'ArrayExpression':
        node.elements.forEach(walk);
        return;
      case 'UnaryExpression':
        walk(node.argument);
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        walk(node.left);
        walk(node.right);
        return;
      case 'ConditionalExpression':
        walk(node.test);
        walk(node.consequent);
        walk(node.alternate);
        return;
      default:
        return;
    }
  };

  walk(ast);
  return { paths: [...paths], roots: [...roots] };
}

export interface ExpressionValidation {
  valid: boolean;
  error?: string;
  /** 引用到的成员路径 */
  references: string[];
  /** 引用到的根标识符 */
  roots: string[];
}

/**
 * 预校验表达式：语法合法性 + 仅引用允许的根变量。
 * @param allowedRoots 允许的根标识符（如 ['form','starter']）；为空表示不限制根
 */
export function validateExpression(expr: string, allowedRoots?: string[]): ExpressionValidation {
  try {
    const ast = parseExpression(expr);
    const { paths, roots } = collectReferences(ast);
    if (allowedRoots && allowedRoots.length > 0) {
      const illegal = roots.filter((r) => !allowedRoots.includes(r));
      if (illegal.length > 0) {
        return { valid: false, error: `引用了未知变量：${illegal.join(', ')}`, references: paths, roots };
      }
    }
    return { valid: true, references: paths, roots };
  } catch (err) {
    const message = err instanceof ExpressionError ? err.message : (err as Error)?.message ?? String(err);
    return { valid: false, error: message, references: [], roots: [] };
  }
}

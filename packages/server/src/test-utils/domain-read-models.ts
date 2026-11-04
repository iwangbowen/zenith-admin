import ts from 'typescript';

export const IDENTITY_READ_TABLES = new Set(['users', 'departments', 'roles', 'positions', 'tenants', 'userRoles', 'userPositions', 'roleDeptScopes', 'userGroups', 'userGroupMembers', 'userGroupRoles']);
/** Tracks imported tables, SQL aliases and RQB projections; write permissions are never inferred from read declarations. */
export function inspectIdentityReadModel(source: string) {
  const syntax = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Map<string, string>();
  const columns = new Map<string, Set<string>>();
  const writes: string[] = [];
  for (const node of syntax.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !node.moduleSpecifier.text.includes('db/schema') || node.importClause?.isTypeOnly) continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const original = binding.propertyName?.text ?? binding.name.text;
      if (!binding.isTypeOnly && IDENTITY_READ_TABLES.has(original)) { names.set(binding.name.text, original); columns.set(original, new Set()); }
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const table = node.initializer.arguments[0];
      if (table && ts.isIdentifier(table) && names.has(table.text)) names.set(node.name.text, names.get(table.text)!);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) columns.get(names.get(node.expression.text)!)!.add(node.name.text);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const table = node.arguments[0];
      if (['insert', 'update', 'delete'].includes(method) && table && ts.isIdentifier(table) && names.has(table.text)) writes.push(`${method}(${names.get(table.text)})`);
      const query = node.expression.expression;
      if (ts.isPropertyAccessExpression(query) && IDENTITY_READ_TABLES.has(query.name.text) && ts.isPropertyAccessExpression(query.expression) && query.expression.name.text === 'query') {
        const set = columns.get(query.name.text) ?? new Set<string>(); columns.set(query.name.text, set);
        if (!['findFirst', 'findMany'].includes(method)) writes.push(`${query.name.text}.${method}`);
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) for (const prop of options.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText(syntax) === 'columns' && ts.isObjectLiteralExpression(prop.initializer)) {
            for (const column of prop.initializer.properties) if (column.name) set.add(column.name.getText(syntax));
          }
        }
      }
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const text = node.template.getText(syntax);
      const interpolatesOwnedTable = ts.isTemplateExpression(node.template) && node.template.templateSpans.some(span => ts.isIdentifier(span.expression) && names.has(span.expression.text));
      if (/\b(?:insert\s+into|update|delete\s+from)\s+["']?(?:users|departments|roles|tenants)\b/i.test(text) || (interpolatesOwnedTable && /\b(?:insert\s+into|update|delete\s+from)\b/i.test(text))) writes.push('raw SQL identity write');
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return { tables: Object.fromEntries([...columns].sort().map(([table, fields]) => [table, [...fields].sort()])), writes };
}

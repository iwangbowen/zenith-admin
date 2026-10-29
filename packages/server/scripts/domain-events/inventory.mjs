#!/usr/bin/env node
/** Static production call inventory; this deliberately makes no runtime reliability claim. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const root = resolve(option('source-root', resolve(import.meta.dirname, '../..')));
const paths = execFileSync('rg', ['--files', 'src', '-g', '*.ts', '-g', '!*.test.ts', '-g', '!*.spec.ts'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
const arity = { emitInstanceEvent: 4, emitTaskEvent: 4, emitNodeEvent: 3, emitTasksEnteredEvents: 4 };
const calls = [];
const sourceHash = createHash('sha256');
for (const file of paths.sort()) {
  const content = readFileSync(resolve(root, file), 'utf8');
  sourceHash.update(file.replaceAll('\\', '/')).update(content);
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const paymentNames = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier.text.endsWith('payment-outbox.service')) continue;
    for (const imported of statement.importClause?.namedBindings?.elements ?? []) {
      if ((imported.propertyName?.text ?? imported.name.text) === 'recordEvent') paymentNames.add(imported.name.text);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      if (/^(openEventBus|workflowEventBus|paymentEventBus)\.(emit|emitAndWait|emitInTx|on|onAny)$/.test(name)
        || name in arity || ['logDriveActivity', 'onWorkflowResult', 'emitIdentityRemoval'].includes(name) || paymentNames.has(name)) {
        calls.push({ name: paymentNames.has(name) ? 'payment.recordEvent' : name, file: file.replaceAll('\\', '/'),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, argumentCount: node.arguments.length,
          missingTransactionArgument: name in arity ? node.arguments.length < arity[name] : undefined });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const summary = {};
for (const call of calls) {
  const value = summary[call.name] ??= { calls: 0, files: [], missingTransactionArguments: 0 };
  value.calls++;
  if (!value.files.includes(call.file)) value.files.push(call.file);
  if (call.missingTransactionArgument) value.missingTransactionArguments++;
}
const result = { kind: 'static-production-inventory', collectedAt: new Date().toISOString(),
  sourceRoot: root, sourceCommit: option('source-ref', execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()),
  sourceSha256: sourceHash.digest('hex'), fileCount: paths.length, summary, calls };
const output = option('out', null);
if (output) { const target = resolve(output); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`); }
console.log(JSON.stringify({ ...result, calls: undefined, sourceRoot: relative(process.cwd(), root) }, null, 2));

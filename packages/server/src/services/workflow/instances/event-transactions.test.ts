import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const folder = fileURLToPath(new URL('.', import.meta.url));
const argumentCounts = new Map([
  ['emitInstanceEvent', 4], ['emitTaskEvent', 4], ['emitNodeEvent', 3], ['emitTasksEnteredEvents', 4],
  ['emitInstanceStartEvents', 5], ['emitMaterializedAdvanceEvents', 5],
]);

describe('workflow business event transaction boundary', () => {
  it('every producer passes and awaits its business transaction instead of using a post-commit fire-and-forget path', () => {
    const errors: string[] = [];
    let calls = 0;
    for (const name of readdirSync(folder).filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))) {
      const source = ts.createSourceFile(name, readFileSync(join(folder, name), 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const required = argumentCounts.get(node.expression.getText(source));
          if (required != null) {
            calls++;
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            if (node.arguments.length !== required || node.arguments[required - 1].getText(source) === 'db') errors.push(`${name}:${line} does not pass a transaction`);
            if (!ts.isAwaitExpression(node.parent) && !ts.isReturnStatement(node.parent)) errors.push(`${name}:${line} does not await event persistence`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(calls).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });
});

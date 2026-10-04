import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function* sourceFiles(dir: string, includeTests = false): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path, includeTests);
    else if (path.endsWith('.ts') && (includeTests || !path.endsWith('.test.ts'))) yield path;
  }
}

const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

export { isCommentLine, sourceFiles };

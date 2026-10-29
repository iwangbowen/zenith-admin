/** Guard the static preview shell: format engines must remain behind dynamic imports. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';

await init;
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
let checked = 0;
for (const directory of readdirSync(dist, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^assets/.test(entry.name))) {
  const files = readdirSync(join(dist, directory.name)).filter((file) => /^FileViewerPreviewPanel-.*\.js$/.test(file));
  for (const file of files) {
    const seen = new Set();
    const visit = (filename) => {
      if (seen.has(filename)) return;
      seen.add(filename);
      for (const imported of parse(readFileSync(filename, 'utf8'))[0]) {
        if (imported.d === -1 && imported.n?.startsWith('.')) visit(resolve(dirname(filename), imported.n));
      }
    };
    visit(join(dist, directory.name, file));
    const forbidden = [...seen].filter((filename) => /vendor-file-viewer-/.test(filename) && !/vendor-file-viewer-(?:core|react)-/.test(filename));
    if (forbidden.length) throw new Error(`File preview statically imports format engines: ${forbidden.join(', ')}`);
    checked++;
  }
}
if (!checked) throw new Error('No built file preview shell found');
console.log(`File preview format isolation passed (${checked} entry shells)`);

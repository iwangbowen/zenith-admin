/**
 * 文件扩展名 → Monaco Editor 语言 id。
 * 只读预览面板与终端文件编辑器共用同一张表，未知扩展名回退 `plaintext`。
 */
const MONACO_LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', json: 'json', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less', md: 'markdown', markdown: 'markdown',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby',
  sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml',
  xml: 'xml', sql: 'sql', toml: 'ini', ini: 'ini', conf: 'ini',
  env: 'ini', vue: 'html', svelte: 'html', graphql: 'graphql', kt: 'kotlin',
  swift: 'swift', dart: 'dart', r: 'r', ex: 'elixir', exs: 'elixir',
  lua: 'lua', m: 'objective-c', mm: 'objective-c',
};

/** 按扩展名（不含点，大小写不敏感）取 Monaco 语言 id，未知回退 `plaintext` */
export function monacoLanguageByExt(ext: string): string {
  return MONACO_LANGUAGE_BY_EXT[ext.toLowerCase()] ?? 'plaintext';
}

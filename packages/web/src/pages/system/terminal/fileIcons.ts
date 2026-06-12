/**
 * 文件 / 文件夹图标映射表
 *
 * 使用 Iconify vscode-icons 图标集，视觉风格与 VS Code material-icon-theme 高度一致。
 * 依赖 @iconify/react（已安装），图标数据由 Iconify API 按需加载并自动缓存。
 */

/** 文件扩展名 → iconify 图标 ID */
const EXT_MAP: Readonly<Record<string, string>> = {
  // TypeScript
  ts: 'vscode-icons:file-type-typescript',
  tsx: 'vscode-icons:file-type-typescript',
  // JavaScript
  js: 'vscode-icons:file-type-javascript',
  jsx: 'vscode-icons:file-type-javascript',
  mjs: 'vscode-icons:file-type-javascript',
  cjs: 'vscode-icons:file-type-javascript',
  // JSON
  json: 'vscode-icons:file-type-json',
  jsonc: 'vscode-icons:file-type-json',
  json5: 'vscode-icons:file-type-json',
  // Markdown
  md: 'vscode-icons:file-type-markdown',
  mdx: 'vscode-icons:file-type-markdown',
  markdown: 'vscode-icons:file-type-markdown',
  // HTML
  html: 'vscode-icons:file-type-html',
  htm: 'vscode-icons:file-type-html',
  xhtml: 'vscode-icons:file-type-html',
  // CSS
  css: 'vscode-icons:file-type-css',
  scss: 'vscode-icons:file-type-scss',
  sass: 'vscode-icons:file-type-sass',
  less: 'vscode-icons:file-type-less',
  styl: 'vscode-icons:file-type-stylus',
  stylus: 'vscode-icons:file-type-stylus',
  // Python
  py: 'vscode-icons:file-type-python',
  pyi: 'vscode-icons:file-type-python',
  // Go
  go: 'vscode-icons:file-type-go',
  // Rust
  rs: 'vscode-icons:file-type-rust',
  // Java
  java: 'vscode-icons:file-type-java',
  // C / C++
  c: 'vscode-icons:file-type-c',
  h: 'vscode-icons:file-type-c',
  cpp: 'vscode-icons:file-type-cpp',
  cc: 'vscode-icons:file-type-cpp',
  cxx: 'vscode-icons:file-type-cpp',
  hpp: 'vscode-icons:file-type-cpp',
  hxx: 'vscode-icons:file-type-cpp',
  // C#
  cs: 'vscode-icons:file-type-csharp',
  // PHP
  php: 'vscode-icons:file-type-php',
  // Ruby
  rb: 'vscode-icons:file-type-ruby',
  // Swift
  swift: 'vscode-icons:file-type-swift',
  // Kotlin
  kt: 'vscode-icons:file-type-kotlin',
  kts: 'vscode-icons:file-type-kotlin',
  // Dart
  dart: 'vscode-icons:file-type-dart',
  // Scala
  scala: 'vscode-icons:file-type-scala',
  // Lua
  lua: 'vscode-icons:file-type-lua',
  // R
  r: 'vscode-icons:file-type-r',
  // YAML
  yml: 'vscode-icons:file-type-yaml',
  yaml: 'vscode-icons:file-type-yaml',
  // XML
  xml: 'vscode-icons:file-type-xml',
  xsl: 'vscode-icons:file-type-xml',
  xslt: 'vscode-icons:file-type-xml',
  // SQL
  sql: 'vscode-icons:file-type-sql',
  // Shell
  sh: 'vscode-icons:file-type-shell',
  bash: 'vscode-icons:file-type-shell',
  zsh: 'vscode-icons:file-type-shell',
  fish: 'vscode-icons:file-type-shell',
  // PowerShell
  ps1: 'vscode-icons:file-type-powershell',
  psm1: 'vscode-icons:file-type-powershell',
  // Batch
  bat: 'vscode-icons:file-type-bat',
  cmd: 'vscode-icons:file-type-bat',
  // Config / env
  env: 'vscode-icons:file-type-dotenv',
  ini: 'vscode-icons:file-type-config',
  conf: 'vscode-icons:file-type-config',
  cfg: 'vscode-icons:file-type-config',
  toml: 'vscode-icons:file-type-toml',
  // Text
  txt: 'vscode-icons:file-type-text',
  log: 'vscode-icons:file-type-log',
  // Lock
  lock: 'vscode-icons:file-type-lock',
  // Images
  png: 'vscode-icons:file-type-image',
  jpg: 'vscode-icons:file-type-image',
  jpeg: 'vscode-icons:file-type-image',
  gif: 'vscode-icons:file-type-image',
  bmp: 'vscode-icons:file-type-image',
  webp: 'vscode-icons:file-type-image',
  ico: 'vscode-icons:file-type-image',
  tiff: 'vscode-icons:file-type-image',
  svg: 'vscode-icons:file-type-svg',
  // Video
  mp4: 'vscode-icons:file-type-video',
  mov: 'vscode-icons:file-type-video',
  avi: 'vscode-icons:file-type-video',
  mkv: 'vscode-icons:file-type-video',
  webm: 'vscode-icons:file-type-video',
  // Audio
  mp3: 'vscode-icons:file-type-audio',
  wav: 'vscode-icons:file-type-audio',
  ogg: 'vscode-icons:file-type-audio',
  flac: 'vscode-icons:file-type-audio',
  // Archive
  zip: 'vscode-icons:file-type-zip',
  tar: 'vscode-icons:file-type-zip',
  gz: 'vscode-icons:file-type-zip',
  rar: 'vscode-icons:file-type-zip',
  '7z': 'vscode-icons:file-type-zip',
  // PDF
  pdf: 'vscode-icons:file-type-pdf',
  // Vue / Svelte
  vue: 'vscode-icons:file-type-vue',
  svelte: 'vscode-icons:file-type-svelte',
  // GraphQL
  graphql: 'vscode-icons:file-type-graphql',
  gql: 'vscode-icons:file-type-graphql',
  // Prisma
  prisma: 'vscode-icons:file-type-prisma',
  // Protobuf
  proto: 'vscode-icons:file-type-proto',
  // WASM
  wasm: 'vscode-icons:file-type-wasm',
  // Certificate / Key
  pem: 'vscode-icons:file-type-cert',
  crt: 'vscode-icons:file-type-cert',
  cer: 'vscode-icons:file-type-cert',
  key: 'vscode-icons:file-type-key',
  // Binary
  exe: 'vscode-icons:file-type-binary',
  dll: 'vscode-icons:file-type-binary',
  so: 'vscode-icons:file-type-binary',
  dylib: 'vscode-icons:file-type-binary',
};

/** 特殊文件名（完整，小写）→ iconify 图标 ID */
const NAME_MAP: Readonly<Record<string, string>> = {
  dockerfile: 'vscode-icons:file-type-docker',
  'docker-compose.yml': 'vscode-icons:file-type-docker',
  'docker-compose.yaml': 'vscode-icons:file-type-docker',
  'docker-compose.override.yml': 'vscode-icons:file-type-docker',
  makefile: 'vscode-icons:file-type-makefile',
  '.gitignore': 'vscode-icons:file-type-git',
  '.gitattributes': 'vscode-icons:file-type-git',
  '.gitmodules': 'vscode-icons:file-type-git',
  '.env': 'vscode-icons:file-type-dotenv',
  '.env.local': 'vscode-icons:file-type-dotenv',
  '.env.example': 'vscode-icons:file-type-dotenv',
  '.env.development': 'vscode-icons:file-type-dotenv',
  '.env.production': 'vscode-icons:file-type-dotenv',
  '.env.test': 'vscode-icons:file-type-dotenv',
  'package.json': 'vscode-icons:file-type-npm',
  'package-lock.json': 'vscode-icons:file-type-npm',
  'yarn.lock': 'vscode-icons:file-type-yarn',
  '.yarnrc': 'vscode-icons:file-type-yarn',
  '.yarnrc.yml': 'vscode-icons:file-type-yarn',
  'pnpm-lock.yaml': 'vscode-icons:file-type-pnpm',
  '.pnpmfile.cjs': 'vscode-icons:file-type-pnpm',
  'bun.lockb': 'vscode-icons:file-type-bun',
  'bunfig.toml': 'vscode-icons:file-type-bun',
  'tsconfig.json': 'vscode-icons:file-type-tsconfig',
  'tsconfig.node.json': 'vscode-icons:file-type-tsconfig',
  'tsconfig.base.json': 'vscode-icons:file-type-tsconfig',
  'jsconfig.json': 'vscode-icons:file-type-jsconfig',
  'vite.config.ts': 'vscode-icons:file-type-vite',
  'vite.config.js': 'vscode-icons:file-type-vite',
  'vite.config.mts': 'vscode-icons:file-type-vite',
  'vite.config.mjs': 'vscode-icons:file-type-vite',
  'vitest.config.ts': 'vscode-icons:file-type-vitest',
  'vitest.config.js': 'vscode-icons:file-type-vitest',
  'webpack.config.js': 'vscode-icons:file-type-webpack',
  'webpack.config.ts': 'vscode-icons:file-type-webpack',
  'rollup.config.js': 'vscode-icons:file-type-rollup',
  'rollup.config.ts': 'vscode-icons:file-type-rollup',
  'eslint.config.js': 'vscode-icons:file-type-eslint',
  'eslint.config.ts': 'vscode-icons:file-type-eslint',
  'eslint.config.mjs': 'vscode-icons:file-type-eslint',
  '.eslintrc': 'vscode-icons:file-type-eslint',
  '.eslintrc.js': 'vscode-icons:file-type-eslint',
  '.eslintrc.json': 'vscode-icons:file-type-eslint',
  '.eslintrc.yml': 'vscode-icons:file-type-eslint',
  '.eslintignore': 'vscode-icons:file-type-eslint',
  '.prettierrc': 'vscode-icons:file-type-prettier',
  '.prettierrc.js': 'vscode-icons:file-type-prettier',
  '.prettierrc.json': 'vscode-icons:file-type-prettier',
  '.prettierrc.yml': 'vscode-icons:file-type-prettier',
  '.prettierignore': 'vscode-icons:file-type-prettier',
  'readme.md': 'vscode-icons:file-type-readme',
  readme: 'vscode-icons:file-type-readme',
  license: 'vscode-icons:file-type-license',
  'license.md': 'vscode-icons:file-type-license',
  licence: 'vscode-icons:file-type-license',
  'changelog.md': 'vscode-icons:file-type-changelog',
  changelog: 'vscode-icons:file-type-changelog',
  '.editorconfig': 'vscode-icons:file-type-editorconfig',
  '.nvmrc': 'vscode-icons:file-type-node',
  '.node-version': 'vscode-icons:file-type-node',
  'jest.config.js': 'vscode-icons:file-type-jest',
  'jest.config.ts': 'vscode-icons:file-type-jest',
  'babel.config.js': 'vscode-icons:file-type-babel',
  'babel.config.json': 'vscode-icons:file-type-babel',
  '.babelrc': 'vscode-icons:file-type-babel',
  'tailwind.config.js': 'vscode-icons:file-type-tailwind',
  'tailwind.config.ts': 'vscode-icons:file-type-tailwind',
  'postcss.config.js': 'vscode-icons:file-type-postcss',
  'next.config.js': 'vscode-icons:file-type-next',
  'next.config.ts': 'vscode-icons:file-type-next',
  'nuxt.config.ts': 'vscode-icons:file-type-nuxt',
  'nuxt.config.js': 'vscode-icons:file-type-nuxt',
  'astro.config.mjs': 'vscode-icons:file-type-astro',
  'drizzle.config.ts': 'vscode-icons:file-type-drizzle',
  'drizzle.config.js': 'vscode-icons:file-type-drizzle',
};

/** 文件夹名（小写）→ iconify 图标 ID 基础值（不含 -open 后缀） */
const FOLDER_MAP: Readonly<Record<string, string>> = {
  src: 'vscode-icons:folder-type-src',
  source: 'vscode-icons:folder-type-src',
  node_modules: 'vscode-icons:folder-type-node',
  public: 'vscode-icons:folder-type-public',
  dist: 'vscode-icons:folder-type-dist',
  build: 'vscode-icons:folder-type-dist',
  out: 'vscode-icons:folder-type-dist',
  output: 'vscode-icons:folder-type-dist',
  '.git': 'vscode-icons:folder-type-git',
  '.github': 'vscode-icons:folder-type-github',
  components: 'vscode-icons:folder-type-components',
  pages: 'vscode-icons:folder-type-views',
  views: 'vscode-icons:folder-type-views',
  screens: 'vscode-icons:folder-type-views',
  hooks: 'vscode-icons:folder-type-hooks',
  utils: 'vscode-icons:folder-type-utils',
  helpers: 'vscode-icons:folder-type-helpers',
  styles: 'vscode-icons:folder-type-styles',
  css: 'vscode-icons:folder-type-styles',
  assets: 'vscode-icons:folder-type-assets',
  images: 'vscode-icons:folder-type-images',
  img: 'vscode-icons:folder-type-images',
  icons: 'vscode-icons:folder-type-icons',
  fonts: 'vscode-icons:folder-type-fonts',
  tests: 'vscode-icons:folder-type-tests',
  test: 'vscode-icons:folder-type-tests',
  __tests__: 'vscode-icons:folder-type-tests',
  spec: 'vscode-icons:folder-type-tests',
  __mocks__: 'vscode-icons:folder-type-mock',
  mocks: 'vscode-icons:folder-type-mock',
  mock: 'vscode-icons:folder-type-mock',
  types: 'vscode-icons:folder-type-typings',
  typings: 'vscode-icons:folder-type-typings',
  interfaces: 'vscode-icons:folder-type-typings',
  api: 'vscode-icons:folder-type-api',
  routes: 'vscode-icons:folder-type-routes',
  middleware: 'vscode-icons:folder-type-middleware',
  services: 'vscode-icons:folder-type-services',
  config: 'vscode-icons:folder-type-config',
  configs: 'vscode-icons:folder-type-config',
  docs: 'vscode-icons:folder-type-docs',
  doc: 'vscode-icons:folder-type-docs',
  documentation: 'vscode-icons:folder-type-docs',
  scripts: 'vscode-icons:folder-type-scripts',
  script: 'vscode-icons:folder-type-scripts',
  lib: 'vscode-icons:folder-type-lib',
  library: 'vscode-icons:folder-type-lib',
  packages: 'vscode-icons:folder-type-packages',
  logs: 'vscode-icons:folder-type-log',
  log: 'vscode-icons:folder-type-log',
  cache: 'vscode-icons:folder-type-cache',
  tmp: 'vscode-icons:folder-type-temp',
  temp: 'vscode-icons:folder-type-temp',
  models: 'vscode-icons:folder-type-models',
  model: 'vscode-icons:folder-type-models',
  db: 'vscode-icons:folder-type-database',
  database: 'vscode-icons:folder-type-database',
  docker: 'vscode-icons:folder-type-docker',
  '.docker': 'vscode-icons:folder-type-docker',
  '.vscode': 'vscode-icons:folder-type-vscode',
  '.idea': 'vscode-icons:folder-type-idea',
  store: 'vscode-icons:folder-type-store',
  redux: 'vscode-icons:folder-type-redux',
  context: 'vscode-icons:folder-type-context',
  providers: 'vscode-icons:folder-type-provider',
  layouts: 'vscode-icons:folder-type-layout',
  layout: 'vscode-icons:folder-type-layout',
  drizzle: 'vscode-icons:folder-type-database',
  migrations: 'vscode-icons:folder-type-database',
  storage: 'vscode-icons:folder-type-archive',
};

const DEFAULT_FILE_ICON = 'vscode-icons:default-file';
const DEFAULT_FOLDER_ICON = 'vscode-icons:default-folder';
const DEFAULT_FOLDER_OPEN_ICON = 'vscode-icons:default-folder-opened';

/**
 * 根据文件名获取 Iconify 图标 ID。
 * 优先完整文件名匹配（大小写不敏感），再匹配扩展名，兜底通用文件图标。
 */
export function getFileIcon(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (NAME_MAP[lower]) return NAME_MAP[lower];
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  return EXT_MAP[ext] ?? DEFAULT_FILE_ICON;
}

/**
 * 根据文件夹名获取 Iconify 图标 ID。
 * isOpen 为 true 时返回展开状态图标（-open 后缀）。
 */
export function getFolderIcon(folderName: string, isOpen = false): string {
  const lower = folderName.toLowerCase();
  const base = FOLDER_MAP[lower];
  if (base) {
    return isOpen ? `${base}-open` : base;
  }
  return isOpen ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON;
}

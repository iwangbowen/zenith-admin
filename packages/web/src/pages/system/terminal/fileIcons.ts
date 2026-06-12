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
  // 字体
  woff: 'vscode-icons:file-type-font',
  woff2: 'vscode-icons:file-type-font',
  ttf: 'vscode-icons:file-type-font',
  eot: 'vscode-icons:file-type-font',
  otf: 'vscode-icons:file-type-font',
  // Jupyter
  ipynb: 'vscode-icons:file-type-jupyter',
  // 数据库
  db: 'vscode-icons:file-type-db',
  sqlite: 'vscode-icons:file-type-db',
  sqlite3: 'vscode-icons:file-type-db',
  // Office 文档
  doc: 'vscode-icons:file-type-word',
  docx: 'vscode-icons:file-type-word',
  xls: 'vscode-icons:file-type-excel',
  xlsx: 'vscode-icons:file-type-excel',
  csv: 'vscode-icons:file-type-csv',
  tsv: 'vscode-icons:file-type-csv',
  ppt: 'vscode-icons:file-type-powerpoint',
  pptx: 'vscode-icons:file-type-powerpoint',
  // 模板语言
  erb: 'vscode-icons:file-type-erb',
  haml: 'vscode-icons:file-type-haml',
  slim: 'vscode-icons:file-type-slim',
  jinja: 'vscode-icons:file-type-jinja',
  j2: 'vscode-icons:file-type-jinja',
  twig: 'vscode-icons:file-type-twig',
  astro: 'vscode-icons:file-type-astro',
  // 函数式语言
  ex: 'vscode-icons:file-type-elixir',
  exs: 'vscode-icons:file-type-elixir',
  hs: 'vscode-icons:file-type-haskell',
  lhs: 'vscode-icons:file-type-haskell',
  erl: 'vscode-icons:file-type-erlang',
  hrl: 'vscode-icons:file-type-erlang',
  clj: 'vscode-icons:file-type-clojure',
  cljs: 'vscode-icons:file-type-clojure',
  cljc: 'vscode-icons:file-type-clojure',
  edn: 'vscode-icons:file-type-clojure',
  fs: 'vscode-icons:file-type-fsharp',
  fsi: 'vscode-icons:file-type-fsharp',
  fsx: 'vscode-icons:file-type-fsharp',
  ml: 'vscode-icons:file-type-ocaml',
  mli: 'vscode-icons:file-type-ocaml',
  // 新兴语言
  nim: 'vscode-icons:file-type-nim',
  zig: 'vscode-icons:file-type-zig',
  cr: 'vscode-icons:file-type-crystal',
  d: 'vscode-icons:file-type-d',
  coffee: 'vscode-icons:file-type-coffeescript',
  // Terraform / HCL
  tf: 'vscode-icons:file-type-terraform',
  tfvars: 'vscode-icons:file-type-terraform',
  hcl: 'vscode-icons:file-type-terraform',
  // Nix
  nix: 'vscode-icons:file-type-nix',
  // JVM 编译产物
  jar: 'vscode-icons:file-type-java',
  class: 'vscode-icons:file-type-java',
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
  // Python 项目文件
  'requirements.txt': 'vscode-icons:file-type-python',
  'requirements-dev.txt': 'vscode-icons:file-type-python',
  'setup.py': 'vscode-icons:file-type-python',
  'setup.cfg': 'vscode-icons:file-type-python',
  'pyproject.toml': 'vscode-icons:file-type-python',
  pipfile: 'vscode-icons:file-type-python',
  'pipfile.lock': 'vscode-icons:file-type-python',
  'tox.ini': 'vscode-icons:file-type-python',
  '.python-version': 'vscode-icons:file-type-python',
  'conda.yml': 'vscode-icons:file-type-python',
  'environment.yml': 'vscode-icons:file-type-python',
  // Rust
  'cargo.toml': 'vscode-icons:file-type-rust',
  'cargo.lock': 'vscode-icons:file-type-rust',
  'rust-toolchain': 'vscode-icons:file-type-rust',
  'rust-toolchain.toml': 'vscode-icons:file-type-rust',
  // Go
  'go.mod': 'vscode-icons:file-type-go',
  'go.sum': 'vscode-icons:file-type-go',
  'go.work': 'vscode-icons:file-type-go',
  // Java / Maven / Gradle
  'pom.xml': 'vscode-icons:file-type-maven',
  'build.gradle': 'vscode-icons:file-type-gradle',
  'build.gradle.kts': 'vscode-icons:file-type-gradle',
  'settings.gradle': 'vscode-icons:file-type-gradle',
  'settings.gradle.kts': 'vscode-icons:file-type-gradle',
  'gradle.properties': 'vscode-icons:file-type-gradle',
  gradlew: 'vscode-icons:file-type-gradle',
  // Ruby
  gemfile: 'vscode-icons:file-type-ruby',
  'gemfile.lock': 'vscode-icons:file-type-ruby',
  rakefile: 'vscode-icons:file-type-ruby',
  '.ruby-version': 'vscode-icons:file-type-ruby',
  // PHP
  'composer.json': 'vscode-icons:file-type-composer',
  'composer.lock': 'vscode-icons:file-type-composer',
  '.htaccess': 'vscode-icons:file-type-htaccess',
  // npm / Node
  '.npmrc': 'vscode-icons:file-type-npm',
  '.npmignore': 'vscode-icons:file-type-npm',
  // 代码规范
  'commitlint.config.js': 'vscode-icons:file-type-commitlint',
  'commitlint.config.ts': 'vscode-icons:file-type-commitlint',
  'commitlint.config.cjs': 'vscode-icons:file-type-commitlint',
  '.commitlintrc': 'vscode-icons:file-type-commitlint',
  '.commitlintrc.json': 'vscode-icons:file-type-commitlint',
  '.czrc': 'vscode-icons:file-type-commitlint',
  '.cz.json': 'vscode-icons:file-type-commitlint',
  '.stylelintrc': 'vscode-icons:file-type-stylelint',
  '.stylelintrc.json': 'vscode-icons:file-type-stylelint',
  '.stylelintrc.yml': 'vscode-icons:file-type-stylelint',
  '.stylelintignore': 'vscode-icons:file-type-stylelint',
  'stylelint.config.js': 'vscode-icons:file-type-stylelint',
  // Monorepo / 工具类
  'nx.json': 'vscode-icons:file-type-nx',
  'turbo.json': 'vscode-icons:file-type-turbo',
  'lerna.json': 'vscode-icons:file-type-lerna',
  'rush.json': 'vscode-icons:file-type-npm',
  // CI / 依赖更新
  'renovate.json': 'vscode-icons:file-type-renovate',
  '.renovaterc': 'vscode-icons:file-type-renovate',
  '.renovaterc.json': 'vscode-icons:file-type-renovate',
  '.travis.yml': 'vscode-icons:file-type-travis',
  'codecov.yml': 'vscode-icons:file-type-yaml',
  // Web manifest
  'robots.txt': 'vscode-icons:file-type-robot',
  'manifest.json': 'vscode-icons:file-type-manifest',
  '.webmanifest': 'vscode-icons:file-type-manifest',
  // 部署 / Hosting
  'firebase.json': 'vscode-icons:file-type-firebase',
  '.firebaserc': 'vscode-icons:file-type-firebase',
  'vercel.json': 'vscode-icons:file-type-vercel',
  'netlify.toml': 'vscode-icons:file-type-netlify',
  'fly.toml': 'vscode-icons:file-type-toml',
  // Capacitor / Electron
  'capacitor.config.ts': 'vscode-icons:file-type-capacitor',
  'capacitor.config.json': 'vscode-icons:file-type-capacitor',
  'electron-builder.config.js': 'vscode-icons:file-type-electron',
  'electron-builder.yml': 'vscode-icons:file-type-electron',
  // Terraform
  'main.tf': 'vscode-icons:file-type-terraform',
  'variables.tf': 'vscode-icons:file-type-terraform',
  'outputs.tf': 'vscode-icons:file-type-terraform',
  'terraform.tfvars': 'vscode-icons:file-type-terraform',
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
  // NestJS 各层
  controllers: 'vscode-icons:folder-type-routes',
  controller: 'vscode-icons:folder-type-routes',
  guards: 'vscode-icons:folder-type-secure',
  guard: 'vscode-icons:folder-type-secure',
  filters: 'vscode-icons:folder-type-middleware',
  filter: 'vscode-icons:folder-type-middleware',
  interceptors: 'vscode-icons:folder-type-middleware',
  interceptor: 'vscode-icons:folder-type-middleware',
  pipes: 'vscode-icons:folder-type-middleware',
  pipe: 'vscode-icons:folder-type-middleware',
  decorators: 'vscode-icons:folder-type-utils',
  decorator: 'vscode-icons:folder-type-utils',
  validators: 'vscode-icons:folder-type-utils',
  validator: 'vscode-icons:folder-type-utils',
  exceptions: 'vscode-icons:folder-type-utils',
  exception: 'vscode-icons:folder-type-utils',
  modules: 'vscode-icons:folder-type-core',
  module: 'vscode-icons:folder-type-core',
  // ORM 层
  entities: 'vscode-icons:folder-type-database',
  entity: 'vscode-icons:folder-type-database',
  repositories: 'vscode-icons:folder-type-database',
  repository: 'vscode-icons:folder-type-database',
  // Redux / 状态管理
  actions: 'vscode-icons:folder-type-redux',
  action: 'vscode-icons:folder-type-redux',
  reducers: 'vscode-icons:folder-type-redux',
  reducer: 'vscode-icons:folder-type-redux',
  selectors: 'vscode-icons:folder-type-redux',
  selector: 'vscode-icons:folder-type-redux',
  sagas: 'vscode-icons:folder-type-redux',
  saga: 'vscode-icons:folder-type-redux',
  effects: 'vscode-icons:folder-type-redux',
  effect: 'vscode-icons:folder-type-redux',
  epics: 'vscode-icons:folder-type-redux',
  // 异步任务
  workers: 'vscode-icons:folder-type-task',
  worker: 'vscode-icons:folder-type-task',
  jobs: 'vscode-icons:folder-type-task',
  job: 'vscode-icons:folder-type-task',
  tasks: 'vscode-icons:folder-type-task',
  task: 'vscode-icons:folder-type-task',
  queues: 'vscode-icons:folder-type-task',
  queue: 'vscode-icons:folder-type-task',
  // 事件
  events: 'vscode-icons:folder-type-event',
  event: 'vscode-icons:folder-type-event',
  listeners: 'vscode-icons:folder-type-event',
  listener: 'vscode-icons:folder-type-event',
  subscribers: 'vscode-icons:folder-type-event',
  subscriber: 'vscode-icons:folder-type-event',
  handlers: 'vscode-icons:folder-type-function',
  handler: 'vscode-icons:folder-type-function',
  // 国际化
  locales: 'vscode-icons:folder-type-i18n',
  locale: 'vscode-icons:folder-type-i18n',
  i18n: 'vscode-icons:folder-type-i18n',
  intl: 'vscode-icons:folder-type-i18n',
  translations: 'vscode-icons:folder-type-i18n',
  translation: 'vscode-icons:folder-type-i18n',
  l10n: 'vscode-icons:folder-type-i18n',
  lang: 'vscode-icons:folder-type-i18n',
  // 应用架构
  features: 'vscode-icons:folder-type-feature',
  feature: 'vscode-icons:folder-type-feature',
  server: 'vscode-icons:folder-type-server',
  client: 'vscode-icons:folder-type-client',
  shared: 'vscode-icons:folder-type-shared',
  common: 'vscode-icons:folder-type-common',
  core: 'vscode-icons:folder-type-core',
  app: 'vscode-icons:folder-type-app',
  // 插件 / 主题
  plugins: 'vscode-icons:folder-type-plugin',
  plugin: 'vscode-icons:folder-type-plugin',
  theme: 'vscode-icons:folder-type-theme',
  themes: 'vscode-icons:folder-type-theme',
  // CI / 基础设施
  '.circleci': 'vscode-icons:folder-type-ci',
  '.gitlab': 'vscode-icons:folder-type-ci',
  workflows: 'vscode-icons:folder-type-ci',
  devops: 'vscode-icons:folder-type-ci',
  terraform: 'vscode-icons:folder-type-terraform',
  infra: 'vscode-icons:folder-type-terraform',
  infrastructure: 'vscode-icons:folder-type-terraform',
  k8s: 'vscode-icons:folder-type-kubernetes',
  kubernetes: 'vscode-icons:folder-type-kubernetes',
  // 测试覆盖率 / 供应商
  coverage: 'vscode-icons:folder-type-coverage',
  vendor: 'vscode-icons:folder-type-vendor',
  // 工具类
  bin: 'vscode-icons:folder-type-bin',
  tools: 'vscode-icons:folder-type-tools',
  tooling: 'vscode-icons:folder-type-tools',
  patches: 'vscode-icons:folder-type-patch',
  // 示例 / 演示
  sandbox: 'vscode-icons:folder-type-sandbox',
  demo: 'vscode-icons:folder-type-sandbox',
  demos: 'vscode-icons:folder-type-sandbox',
  examples: 'vscode-icons:folder-type-sandbox',
  example: 'vscode-icons:folder-type-sandbox',
  playground: 'vscode-icons:folder-type-playground',
  // 数据 / 内容
  data: 'vscode-icons:folder-type-resource',
  content: 'vscode-icons:folder-type-resource',
  // 上传 / 媒体
  uploads: 'vscode-icons:folder-type-uploads',
  upload: 'vscode-icons:folder-type-uploads',
  media: 'vscode-icons:folder-type-uploads',
  // 导出
  reports: 'vscode-icons:folder-type-export',
  exports: 'vscode-icons:folder-type-export',
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

/** Shell 类型 ID → iconify 图标 ID（用于终端标签，与 listShells() 返回的 id 对齐） */
const SHELL_ICON_MAP: Readonly<Record<string, string>> = {
  powershell: 'vscode-icons:file-type-powershell',
  cmd: 'codicon:terminal-cmd',
  bash: 'vscode-icons:file-type-shell',
  zsh: 'vscode-icons:file-type-shell',
  fish: 'vscode-icons:file-type-shell',
  sh: 'vscode-icons:file-type-shell',
};

const DEFAULT_SHELL_ICON = 'vscode-icons:file-type-shell';

/**
 * 根据 shell 类型 ID 获取 Iconify 图标 ID。
 * 未知类型兜底为通用 shell 图标。
 */
export function getShellIcon(shellId: string | undefined): string {
  if (!shellId) return DEFAULT_SHELL_ICON;
  return SHELL_ICON_MAP[shellId.toLowerCase()] ?? DEFAULT_SHELL_ICON;
}

import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { ident, parse, walk } from 'css-tree';
import {
  cmsThemePackageManifestSchema,
  type CmsThemePackageManifest,
  type CmsThemePackageValidationReport,
  type CmsTemplateValidationIssue,
} from '@zenith/shared';
import {
  canonicalizeCmsJson,
  collectCmsTemplateDslAssetReferences,
  validateCmsTemplateDsl,
} from '../../cms/templates/dsl';

export const CMS_THEME_PACKAGE_LIMITS = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxFiles: 100,
  maxFileBytes: 3 * 1024 * 1024,
  maxUncompressedBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 30,
} as const;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const FORBIDDEN_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.exe', '.dll', '.so', '.dylib', '.com', '.bat', '.cmd', '.ps1', '.sh',
  '.jar', '.class', '.wasm', '.node', '.msi', '.scr', '.app', '.apk',
]);
const ASSET_EXTENSIONS = new Set(['.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2']);
const SAFE_PACKAGE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  localOffset: number;
  archiveDataEnd: number;
}

export interface ParsedCmsThemePackage {
  report: CmsThemePackageValidationReport;
  files: Map<string, Buffer>;
}

export function isCmsThemeAssetDeploymentMatch(input: {
  siteId: number;
  siteTheme: string;
  deploymentSiteId: number;
  deploymentThemeCode: string;
  deploymentStatus: 'active' | 'inactive';
  packageCode: string;
  packageVersion: string;
  packageStatus: 'validated' | 'disabled';
  packageValidationPassed: boolean;
  requestedCode: string;
  requestedVersion: string;
}): boolean {
  return input.siteId === input.deploymentSiteId
    && input.deploymentStatus === 'active'
    && input.siteTheme === input.requestedCode
    && input.deploymentThemeCode === input.requestedCode
    && input.packageCode === input.requestedCode
    && input.packageVersion === input.requestedVersion
    && input.packageStatus === 'validated'
    && input.packageValidationPassed;
}

function issue(path: string, code: string, message: string): CmsTemplateValidationIssue {
  return { path, code, message };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function extension(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

export function normalizeCmsThemePackagePath(raw: string): string {
  if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:/.test(raw)) {
    throw new Error('主题包路径必须是相对 POSIX 路径');
  }
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('主题包路径禁止空段、点路径或目录穿越');
  }
  if (!SAFE_PACKAGE_PATH.test(raw)) throw new Error('主题包路径包含不允许的字符或过长');
  return segments.join('/');
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('不是有效 ZIP：缺少中央目录');
}

function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new Error('不支持分卷 ZIP');
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('不支持 ZIP64');
  if (eocd + 22 + commentLength !== buffer.length) throw new Error('ZIP 尾部结构异常');
  if (totalEntries > CMS_THEME_PACKAGE_LIMITS.maxFiles) throw new Error(`主题包文件数不能超过 ${CMS_THEME_PACKAGE_LIMITS.maxFiles}`);
  if (centralOffset + centralSize > eocd) throw new Error('ZIP 中央目录越界');

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('ZIP 中央目录条目损坏');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (end > buffer.length) throw new Error('ZIP 文件名或扩展字段越界');
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (name.includes('\uFFFD') || !Buffer.from(name, 'utf8').equals(nameBytes)) throw new Error('ZIP 文件名必须使用 UTF-8');
    if (localOffset >= centralOffset) throw new Error('ZIP 本地文件头越过中央目录');
    entries.push({ name, method, flags, compressedSize, uncompressedSize, externalAttributes, localOffset, archiveDataEnd: centralOffset });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error('ZIP 中央目录长度不一致');
  return entries;
}

function isSymlink(entry: ZipEntry): boolean {
  const unixMode = (entry.externalAttributes >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

function extractEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.flags & 0x1) throw new Error(`文件 ${entry.name} 使用了加密，禁止导入`);
  if (![0, 8].includes(entry.method)) throw new Error(`文件 ${entry.name} 使用了不支持的压缩算法`);
  if (entry.compressedSize > CMS_THEME_PACKAGE_LIMITS.maxArchiveBytes || entry.uncompressedSize > CMS_THEME_PACKAGE_LIMITS.maxFileBytes) {
    throw new Error(`文件 ${entry.name} 超出单文件大小限制`);
  }
  const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
  if (ratio > CMS_THEME_PACKAGE_LIMITS.maxCompressionRatio) throw new Error(`文件 ${entry.name} 解压比过高，疑似 zip bomb`);
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) {
    throw new Error(`文件 ${entry.name} 的本地头损坏`);
  }
  const localFlags = buffer.readUInt16LE(entry.localOffset + 6);
  const localMethod = buffer.readUInt16LE(entry.localOffset + 8);
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  if (localFlags !== entry.flags || localMethod !== entry.method) throw new Error(`文件 ${entry.name} 的 ZIP 元数据不一致`);
  const localName = buffer.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength).toString('utf8');
  if (localName !== entry.name) throw new Error(`文件 ${entry.name} 的中央目录与本地头名称不一致`);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > entry.archiveDataEnd) throw new Error(`文件 ${entry.name} 的压缩数据越界或覆盖中央目录`);
  const compressed = buffer.subarray(start, end);
  const output = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, {
    maxOutputLength: CMS_THEME_PACKAGE_LIMITS.maxFileBytes + 1,
  });
  if (output.length !== entry.uncompressedSize) throw new Error(`文件 ${entry.name} 解压长度与声明不一致`);
  return output;
}

function parseTrustedPublicKeys(raw: string): Map<string, KeyObject> {
  if (!raw.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CMS_THEME_TRUSTED_PUBLIC_KEYS 必须是 JSON 对象');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('CMS_THEME_TRUSTED_PUBLIC_KEYS 必须是 JSON 对象');
  const keys = new Map<string, KeyObject>();
  for (const [id, material] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || typeof material !== 'string' || !material.trim()) {
      throw new Error('可信公钥 key id 或 key material 格式无效');
    }
    const normalized = material.includes('BEGIN') ? material.replaceAll('\\n', '\n') : {
      key: Buffer.from(material, 'base64'),
      format: 'der' as const,
      type: 'spki' as const,
    };
    const key = createPublicKey(normalized);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error(`可信公钥 ${id} 不是 Ed25519`);
    keys.set(id, key);
  }
  return keys;
}

export function assertCmsThemeTrustedKeysConfigured(raw: string): void {
  const keys = parseTrustedPublicKeys(raw);
  if (keys.size === 0) throw new Error('未配置 CMS_THEME_TRUSTED_PUBLIC_KEYS，主题包导入已安全关闭');
}

export function cmsThemeManifestSigningPayload(manifest: CmsThemePackageManifest): Buffer {
  const { signature: _signature, ...unsigned } = manifest;
  return Buffer.from(canonicalizeCmsJson(unsigned), 'utf8');
}

function validateCmsThemeCss(name: string, content: Buffer, declaredAssets: ReadonlySet<string>): void {
  const css = content.toString('utf8');
  if (css.includes('\uFFFD') || css.includes('\0')) throw new Error(`CSS 资源 ${name} 不是有效 UTF-8 文本`);
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(css, {
      context: 'stylesheet',
      positions: true,
      parseAtrulePrelude: true,
      parseValue: true,
    });
  } catch (error) {
    throw new Error(`CSS 资源 ${name} 解析失败：${error instanceof Error ? error.message : '语法无效'}`, { cause: error });
  }
  const cssDir = path.posix.dirname(name);
  const baseUrl = new URL(`https://theme.invalid/${cssDir.replace(/^\/+/, '')}/`);
  const validateAssetReference = (raw: string) => {
    const decoded = raw.trim();
    if (!decoded || decoded.includes('\\') || decoded.startsWith('/') || decoded.startsWith('//')) {
      throw new Error(`CSS 资源 ${name} 包含非包内相对 URL：${raw}`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(decoded, baseUrl);
    } catch {
      throw new Error(`CSS 资源 ${name} URL 无效：${raw}`);
    }
    if (parsedUrl.origin !== baseUrl.origin || parsedUrl.search || parsedUrl.hash) {
      throw new Error(`CSS 资源 ${name} 禁止外部、data 或带参数 URL：${raw}`);
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    } catch {
      throw new Error(`CSS 资源 ${name} URL 编码无效：${raw}`);
    }
    const resolved = normalizeCmsThemePackagePath(pathname);
    if (!resolved.startsWith('assets/') || !declaredAssets.has(resolved)) {
      throw new Error(`CSS 资源 ${name} 引用了 manifest 未声明或越界的资源：${raw}`);
    }
  };
  walk(ast, function validateCssNode(node) {
    if (node.type === 'Raw') {
      throw new Error(`CSS 资源 ${name} 包含无法安全解析的 Raw 语法`);
    }
    if (node.type === 'Declaration' && ident.decode(node.property).startsWith('--')) {
      throw new Error(`CSS 资源 ${name} 禁止自定义属性`);
    }
    if (node.type === 'Atrule' && ident.decode(node.name).toLowerCase() === 'import') {
      throw new Error(`CSS 资源 ${name} 禁止 @import`);
    }
    if (node.type === 'Function') {
      const functionName = ident.decode(node.name).toLowerCase();
      if (['expression', 'local', 'url-prefix', 'domain', 'var'].includes(functionName)) {
        throw new Error(`CSS 资源 ${name} 禁止 ${functionName}()`);
      }
    }
    if (node.type === 'Url') {
      validateAssetReference(node.value);
      return;
    }
    if (node.type === 'String' && this.function) {
      const functionName = ident.decode(this.function.name).toLowerCase();
      if (['image', 'image-set', '-webkit-image-set', 'src'].includes(functionName)) {
        validateAssetReference(node.value);
      }
    }
  });
}

export function validateCmsThemeAsset(
  name: string,
  content: Buffer,
  declaredAssets: ReadonlySet<string>,
): void {
  const ext = extension(name);
  if (!ASSET_EXTENSIONS.has(ext)) throw new Error(`静态资源 ${name} 类型不在白名单`);
  if (ext === '.css') {
    validateCmsThemeCss(name, content, declaredAssets);
    return;
  }
  const valid = (
    (ext === '.png' && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || ((ext === '.jpg' || ext === '.jpeg') && content[0] === 0xff && content[1] === 0xd8)
    || (ext === '.gif' && ['GIF87a', 'GIF89a'].includes(content.subarray(0, 6).toString('ascii')))
    || (ext === '.webp' && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP')
    || (ext === '.woff' && content.subarray(0, 4).toString('ascii') === 'wOFF')
    || (ext === '.woff2' && content.subarray(0, 4).toString('ascii') === 'wOF2')
  );
  if (!valid) throw new Error(`静态资源 ${name} 的内容与扩展名不匹配`);
}

function emptyReport(buffer: Buffer): CmsThemePackageValidationReport {
  return {
    valid: false,
    archiveChecksum: sha256(buffer),
    manifest: null,
    fileCount: 0,
    compressedBytes: buffer.length,
    uncompressedBytes: 0,
    issues: [],
  };
}

export function validateCmsThemePackageArchive(
  buffer: Buffer,
  trustedPublicKeys: string,
  engineVersion: number,
): ParsedCmsThemePackage {
  const report = emptyReport(buffer);
  const files = new Map<string, Buffer>();
  try {
    if (buffer.length > CMS_THEME_PACKAGE_LIMITS.maxArchiveBytes) {
      throw new Error(`主题包不能超过 ${CMS_THEME_PACKAGE_LIMITS.maxArchiveBytes} 字节`);
    }
    const entries = parseCentralDirectory(buffer);
    const names = new Set<string>();
    let totalUncompressed = 0;
    for (const entry of entries) {
      if (isSymlink(entry)) throw new Error(`主题包禁止符号链接：${entry.name}`);
      if (entry.name.endsWith('/')) {
        if (entry.compressedSize || entry.uncompressedSize) throw new Error(`目录条目 ${entry.name} 不应包含数据`);
        normalizeCmsThemePackagePath(entry.name.slice(0, -1));
        continue;
      }
      const name = normalizeCmsThemePackagePath(entry.name);
      if (names.has(name)) throw new Error(`主题包包含重复路径：${name}`);
      names.add(name);
      if (FORBIDDEN_EXTENSIONS.has(extension(name))) throw new Error(`主题包禁止可执行代码或二进制：${name}`);
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > CMS_THEME_PACKAGE_LIMITS.maxUncompressedBytes) {
        throw new Error(`主题包解压后总大小不能超过 ${CMS_THEME_PACKAGE_LIMITS.maxUncompressedBytes} 字节`);
      }
      files.set(name, extractEntry(buffer, entry));
    }
    report.fileCount = files.size;
    report.uncompressedBytes = totalUncompressed;
    const manifestBuffer = files.get('manifest.json');
    if (!manifestBuffer) throw new Error('主题包根目录缺少 manifest.json');
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestBuffer.toString('utf8'));
    } catch {
      throw new Error('manifest.json 不是有效 UTF-8 JSON');
    }
    const parsed = cmsThemePackageManifestSchema.safeParse(manifestJson);
    if (!parsed.success) {
      report.issues.push(...parsed.error.issues.map((item) => issue(`manifest.${item.path.join('.')}`, item.code, item.message)));
      return { report, files: new Map() };
    }
    const manifest = parsed.data as CmsThemePackageManifest;
    report.manifest = manifest;
    if (manifest.engine.min > manifest.engine.max || engineVersion < manifest.engine.min || engineVersion > manifest.engine.max) {
      throw new Error(`主题包引擎兼容范围 ${manifest.engine.min}-${manifest.engine.max} 不包含当前版本 ${engineVersion}`);
    }

    const declared = new Set(['manifest.json']);
    const templateKeys = new Set<string>();
    for (const template of manifest.templates) {
      const path = normalizeCmsThemePackagePath(template.path);
      if (!path.startsWith('templates/') || extension(path) !== '.json') throw new Error(`模板 ${template.code} 必须位于 templates/*.json`);
      const logicalKey = `${template.type}:${template.code}`;
      if (templateKeys.has(logicalKey)) throw new Error(`主题包模板重复：${logicalKey}`);
      templateKeys.add(logicalKey);
      declared.add(path);
    }
    for (const asset of manifest.assets) {
      const path = normalizeCmsThemePackagePath(asset);
      if (!path.startsWith('assets/')) throw new Error(`静态资源必须位于 assets/：${path}`);
      declared.add(path);
    }
    for (const name of files.keys()) {
      if (!declared.has(name)) throw new Error(`主题包包含 manifest 未声明的文件：${name}`);
    }
    for (const name of declared) {
      if (!files.has(name)) throw new Error(`manifest 声明的文件不存在：${name}`);
      if (name === 'manifest.json') continue;
      const expected = manifest.checksums[name];
      if (!expected) throw new Error(`manifest.checksums 缺少 ${name}`);
      if (sha256(files.get(name)!) !== expected) throw new Error(`文件校验和不匹配：${name}`);
    }
    const checksumKeys = Object.keys(manifest.checksums);
    if (checksumKeys.some((name) => !declared.has(name) || name === 'manifest.json')) {
      throw new Error('manifest.checksums 包含未声明文件');
    }
    const declaredAssets = new Set(manifest.assets);
    for (const template of manifest.templates) {
      const content = files.get(template.path)!;
      let dsl: unknown;
      try {
        dsl = JSON.parse(content.toString('utf8'));
      } catch {
        throw new Error(`模板 ${template.path} 不是有效 JSON`);
      }
      const dslReport = validateCmsTemplateDsl(dsl);
      if (!dslReport.valid) {
        throw new Error(`模板 ${template.path} 校验失败：${dslReport.issues[0]?.message ?? '未知错误'}`);
      }
      for (const assetRef of collectCmsTemplateDslAssetReferences(dsl)) {
        const declaredPath = normalizeCmsThemePackagePath(`assets/${assetRef}`);
        if (!declaredAssets.has(declaredPath)) {
          throw new Error(`模板 ${template.path} 引用了 manifest 未声明的资源：${assetRef}`);
        }
      }
    }
    for (const asset of manifest.assets) validateCmsThemeAsset(asset, files.get(asset)!, declaredAssets);

    const keys = parseTrustedPublicKeys(trustedPublicKeys);
    if (keys.size === 0) throw new Error('未配置 CMS_THEME_TRUSTED_PUBLIC_KEYS，主题包导入已安全关闭');
    const publicKey = keys.get(manifest.signingKeyId);
    if (!publicKey) throw new Error(`签名 key id「${manifest.signingKeyId}」不受信任`);
    let signature: Buffer;
    try {
      signature = Buffer.from(manifest.signature, 'base64');
    } catch {
      throw new Error('manifest.signature 不是有效 Base64');
    }
    if (!signature.length || !verify(null, cmsThemeManifestSigningPayload(manifest), publicKey, signature)) {
      throw new Error('主题包 Ed25519 签名验证失败');
    }
    report.valid = true;
    return { report, files };
  } catch (error) {
    report.issues.push(issue('$', 'package_invalid', error instanceof Error ? error.message : '主题包校验失败'));
    return { report, files: new Map() };
  }
}

function parsePrivateKey(raw: string): KeyObject {
  if (!raw.trim()) throw new Error('未配置 CMS_THEME_SIGNING_PRIVATE_KEY，签名导出不可用');
  const normalized = raw.includes('BEGIN') ? raw.replaceAll('\\n', '\n') : {
    key: Buffer.from(raw, 'base64'),
    format: 'der' as const,
    type: 'pkcs8' as const,
  };
  const key = createPrivateKey(normalized);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('CMS_THEME_SIGNING_PRIVATE_KEY 不是 Ed25519 私钥');
  return key;
}

export function signCmsThemePackageManifest(
  manifest: Omit<CmsThemePackageManifest, 'signature' | 'signingKeyId'>,
  signingKeyId: string,
  privateKeyRaw: string,
): CmsThemePackageManifest {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(signingKeyId)) {
    throw new Error('未配置有效的 CMS_THEME_SIGNING_KEY_ID，签名导出不可用');
  }
  const unsigned = { ...manifest, signingKeyId, signature: '' } as CmsThemePackageManifest;
  const signature = sign(null, cmsThemeManifestSigningPayload(unsigned), parsePrivateKey(privateKeyRaw)).toString('base64');
  return { ...unsigned, signature };
}

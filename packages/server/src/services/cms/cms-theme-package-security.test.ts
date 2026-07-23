import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CmsTemplateDslDocument, CmsThemePackageManifest } from '@zenith/shared';
import {
  isCmsThemeAssetDeploymentMatch,
  signCmsThemePackageManifest,
  validateCmsThemePackageArchive,
} from './cms-theme-package-security';

interface ZipTestEntry {
  name: string;
  content: Buffer;
  externalAttributes?: number;
  declaredCompressedSize?: number;
  declaredUncompressedSize?: number;
}

function testZip(entries: ZipTestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const compressed = entry.declaredCompressedSize ?? entry.content.length;
    const uncompressed = entry.declaredUncompressedSize ?? entry.content.length;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, entry.content);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + entry.content.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function signedPackage(extra?: ZipTestEntry[]) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const dsl: CmsTemplateDslDocument = {
    version: 1,
    root: { kind: 'element', tag: 'html', children: [{ kind: 'element', tag: 'body', children: [{ kind: 'text', value: 'safe' }] }] },
  };
  const template = Buffer.from(JSON.stringify(dsl));
  const unsigned: Omit<CmsThemePackageManifest, 'signature' | 'signingKeyId'> = {
    schemaVersion: 1,
    code: 'signed-theme',
    name: 'Signed Theme',
    version: '1.0.0',
    engine: { min: 1, max: 1 },
    templates: [{ code: 'home', name: 'Home', type: 'index', path: 'templates/home.json' }],
    assets: [],
    checksums: { 'templates/home.json': createHash('sha256').update(template).digest('hex') },
  };
  const manifest = signCmsThemePackageManifest(
    unsigned,
    'test-key',
    privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  );
  const zipEntries = [
    { name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest)) },
    { name: 'templates/home.json', content: template },
    ...(extra ?? []),
  ];
  return {
    buffer: testZip(zipEntries),
    trusted: JSON.stringify({ 'test-key': publicKey.export({ format: 'pem', type: 'spki' }).toString() }),
    manifest,
    template,
  };
}

function signedPackageWithAssets(assets: ZipTestEntry[]) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const dsl: CmsTemplateDslDocument = {
    version: 1,
    root: { kind: 'element', tag: 'html', children: [{ kind: 'element', tag: 'body', children: [{ kind: 'text', value: 'safe' }] }] },
  };
  const template = Buffer.from(JSON.stringify(dsl));
  const checksums = Object.fromEntries([
    ['templates/home.json', template] as const,
    ...assets.map((asset) => [asset.name, asset.content] as const),
  ].map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')]));
  const manifest = signCmsThemePackageManifest({
    schemaVersion: 1,
    code: 'css-theme',
    name: 'CSS Theme',
    version: '1.0.0',
    engine: { min: 1, max: 1 },
    templates: [{ code: 'home', name: 'Home', type: 'index', path: 'templates/home.json' }],
    assets: assets.map((asset) => asset.name),
    checksums,
  }, 'test-key', privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
  return {
    buffer: testZip([
      { name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest)) },
      { name: 'templates/home.json', content: template },
      ...assets,
    ]),
    trusted: JSON.stringify({ 'test-key': publicKey.export({ format: 'pem', type: 'spki' }).toString() }),
  };
}

describe('CMS signed theme package security', () => {
  it('serves assets only for the exact active deployment of the requested site', () => {
    const active = {
      siteId: 1,
      siteTheme: 'signed-theme',
      deploymentSiteId: 1,
      deploymentThemeCode: 'signed-theme',
      deploymentStatus: 'active' as const,
      packageCode: 'signed-theme',
      packageVersion: '1.0.0',
      packageStatus: 'validated' as const,
      packageValidationPassed: true,
      requestedCode: 'signed-theme',
      requestedVersion: '1.0.0',
    };
    expect(isCmsThemeAssetDeploymentMatch(active)).toBe(true);
    expect(isCmsThemeAssetDeploymentMatch({ ...active, deploymentStatus: 'inactive' })).toBe(false);
    expect(isCmsThemeAssetDeploymentMatch({ ...active, siteId: 2 })).toBe(false);
    expect(isCmsThemeAssetDeploymentMatch({ ...active, requestedVersion: '2.0.0' })).toBe(false);
    expect(isCmsThemeAssetDeploymentMatch({ ...active, packageValidationPassed: false })).toBe(false);
  });

  it('accepts a valid Ed25519-signed declarative package', () => {
    const pkg = signedPackage();
    const parsed = validateCmsThemePackageArchive(pkg.buffer, pkg.trusted, 1);
    expect(parsed.report.valid).toBe(true);
    expect(parsed.report.manifest?.code).toBe('signed-theme');
    expect(parsed.files.has('templates/home.json')).toBe(true);
  });

  it('fails closed without trusted keys and rejects a wrong trust root', () => {
    const pkg = signedPackage();
    expect(validateCmsThemePackageArchive(pkg.buffer, '', 1).report.issues[0]?.message).toContain('未配置');
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const result = validateCmsThemePackageArchive(pkg.buffer, JSON.stringify({ 'test-key': other }), 1);
    expect(result.report.valid).toBe(false);
    expect(result.report.issues[0]?.message).toContain('签名验证失败');
  });

  it.each([
    ['path traversal', { name: '../escape.json', content: Buffer.from('{}') }, '路径'],
    ['executable code', { name: 'assets/runtime.js', content: Buffer.from('alert(1)') }, '可执行'],
    ['symlink', { name: 'assets/link.css', content: Buffer.alloc(0), externalAttributes: 0xa1ff0000 }, '符号链接'],
    ['zip bomb ratio', { name: 'assets/bomb.css', content: Buffer.from('x'), declaredCompressedSize: 1, declaredUncompressedSize: 1000 }, 'zip bomb'],
  ])('rejects %s entries before extraction', (_name, badEntry, message) => {
    const pkg = signedPackage();
    const entries = [
      { name: 'manifest.json', content: Buffer.from(JSON.stringify(pkg.manifest)) },
      { name: 'templates/home.json', content: pkg.template },
      badEntry,
    ];
    const result = validateCmsThemePackageArchive(testZip(entries), pkg.trusted, 1);
    expect(result.report.valid).toBe(false);
    expect(result.report.issues[0]?.message).toContain(message);
  });

  it('rejects tampered template bytes even when the manifest signature itself is valid', () => {
    const pkg = signedPackage();
    const tampered = testZip([
      { name: 'manifest.json', content: Buffer.from(JSON.stringify(pkg.manifest)) },
      { name: 'templates/home.json', content: Buffer.from('{"version":1,"root":{"kind":"text","value":"tampered"}}') },
    ]);
    const result = validateCmsThemePackageArchive(tampered, pkg.trusted, 1);
    expect(result.report.valid).toBe(false);
    expect(result.report.issues[0]?.message).toContain('校验和不匹配');
  });

  it.each([
    String.raw`@\69mport url(h\74tps://evil.example/theme.css);`,
    String.raw`.hero{background-image:url(h\74tps://evil.example/pixel.png)}`,
    String.raw`.hero{background-image:url(data:image/png;base64,AAAA)}`,
    String.raw`.hero{background-image:url(../../outside.png)}`,
    String.raw`.hero{background-image:image-set("https://evil.example/pixel.png" 1x)}`,
    String.raw`@font-face{font-family:x;src:local("Secret Font")}`,
    String.raw`:root{\2d-remote:url(https://evil.example/pixel.png)}.hero{background:var(\2d-remote)}`,
    String.raw`.hero{background:var(--remote)}`,
    String.raw`.hero{color:red;broken raw payload}`,
  ])('parses and rejects escaped/external CSS resource %s', (css) => {
    const pkg = signedPackageWithAssets([{ name: 'assets/css/site.css', content: Buffer.from(css) }]);
    const result = validateCmsThemePackageArchive(pkg.buffer, pkg.trusted, 1);
    expect(result.report.valid).toBe(false);
    expect(result.report.issues[0]?.message).toMatch(/CSS|URL|@import|资源/);
  });

  it('accepts parsed CSS that references only declared package-relative assets', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pkg = signedPackageWithAssets([
      { name: 'assets/css/site.css', content: Buffer.from('.hero{background-image:url(../images/bg.png)}') },
      { name: 'assets/images/bg.png', content: png },
    ]);
    expect(validateCmsThemePackageArchive(pkg.buffer, pkg.trusted, 1).report.valid).toBe(true);
  });
});

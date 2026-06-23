import { execFile } from 'node:child_process';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { HTTPException } from 'hono/http-exception';
import { formatNullableDateTime } from '../lib/datetime';

const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const MOCK_INFO = {
  installed: false,
  version: null,
  configPath: null,
  sitesAvailable: null,
  sitesEnabled: null,
  runningStatus: 'unknown' as const,
};

const MOCK_SITES = [
  {
    name: 'default',
    enabled: true,
    configPath: '/etc/nginx/sites-available/default',
    serverName: '_',
    listenPort: 80,
    root: '/var/www/html',
    sslEnabled: false,
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
  {
    name: 'example.com',
    enabled: true,
    configPath: '/etc/nginx/sites-available/example.com',
    serverName: 'example.com www.example.com',
    listenPort: 443,
    root: '/var/www/example.com',
    sslEnabled: true,
    createdAt: '2024-03-15 10:00:00',
    updatedAt: '2024-03-15 10:00:00',
  },
  {
    name: 'api.example.com',
    enabled: false,
    configPath: '/etc/nginx/sites-available/api.example.com',
    serverName: 'api.example.com',
    listenPort: 80,
    root: null,
    sslEnabled: false,
    createdAt: '2024-05-01 08:00:00',
    updatedAt: '2024-05-01 08:00:00',
  },
];

const MOCK_CONFIG = `server {
    listen 80;
    server_name example.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}`;

export interface NginxInfoData {
  installed: boolean;
  version: string | null;
  configPath: string | null;
  sitesAvailable: string | null;
  sitesEnabled: string | null;
  runningStatus: 'running' | 'stopped' | 'unknown';
}

export interface NginxSiteData {
  name: string;
  enabled: boolean;
  configPath: string;
  serverName: string | null;
  listenPort: number | null;
  root: string | null;
  sslEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NginxSiteDetailData extends NginxSiteData {
  content: string;
}

export interface CreateNginxSiteInput {
  name: string;
  serverName: string;
  listenPort: number;
  root?: string;
  proxyPass?: string;
  sslEnabled?: boolean;
  sslCertPath?: string;
  sslKeyPath?: string;
  extraConfig?: string;
}

interface ParsedSiteConfig {
  serverName: string | null;
  listenPort: number | null;
  root: string | null;
  sslEnabled: boolean;
}

interface NginxDetectionResult {
  installed: boolean;
  version: string | null;
  configDir: string | null;
  configPath: string | null;
}

type NginxLayout =
  | { mode: 'mock'; configPath: null; sitesAvailable: null; sitesEnabled: null }
  | { mode: 'symlink'; configPath: string | null; sitesAvailable: string; sitesEnabled: string }
  | { mode: 'single-dir'; configPath: string | null; sitesAvailable: string; sitesEnabled: string };

function validateSiteName(name: string): void {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name)) {
    throw new HTTPException(400, { message: '非法站点名称' });
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetPath: string): Promise<void> {
  await fsp.mkdir(targetPath, { recursive: true });
}

function normalizeSingleDirName(name: string): string {
  return name.endsWith('.conf') ? name.slice(0, -5) : name;
}

function buildSingleDirEnabledPath(dir: string, name: string): string {
  return path.join(dir, `${normalizeSingleDirName(name)}.conf`);
}

function buildSingleDirDisabledPath(dir: string, name: string): string {
  return `${buildSingleDirEnabledPath(dir, name)}.disabled`;
}

async function detectNginx(): Promise<NginxDetectionResult> {
  if (isWindows) {
    return {
      installed: false,
      version: null,
      configDir: null,
      configPath: null,
    };
  }

  const candidates = isMac ? ['/usr/local/etc/nginx'] : ['/etc/nginx'];
  let version: string | null = null;
  let configPath: string | null = null;
  let configDir: string | null = null;
  let commandFound = false;

  try {
    const { stdout, stderr } = await execFileAsync('nginx', ['-V'], { timeout: 5000 });
    const output = `${stdout}\n${stderr}`;
    version = output.match(/nginx\/(\S+)/)?.[1] ?? null;
    configPath = output.match(/--conf-path=(\S+)/)?.[1] ?? null;
    configDir = configPath ? path.dirname(configPath) : null;
    commandFound = true;
  } catch {
    try {
      const { stdout, stderr } = await execFileAsync('nginx', ['-v'], { timeout: 5000 });
      const output = `${stdout}\n${stderr}`;
      version = output.match(/nginx\/(\S+)/)?.[1] ?? null;
      commandFound = true;
    } catch {
      commandFound = false;
    }
  }

  if (!configDir) {
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        configDir = candidate;
        break;
      }
    }
  }

  if (!configPath && configDir) {
    const fallbackConfigPath = path.join(configDir, 'nginx.conf');
    if (await pathExists(fallbackConfigPath)) configPath = fallbackConfigPath;
  }

  return {
    installed: commandFound || !!configDir,
    version,
    configDir,
    configPath,
  };
}

async function resolveNginxLayout(): Promise<NginxLayout> {
  if (isWindows) return { mode: 'mock', configPath: null, sitesAvailable: null, sitesEnabled: null };

  const detected = await detectNginx();
  const configDir = detected.configDir ?? (isMac ? '/usr/local/etc/nginx' : '/etc/nginx');
  const sitesAvailable = path.join(configDir, 'sites-available');
  const sitesEnabled = path.join(configDir, 'sites-enabled');
  const confd = path.join(configDir, 'conf.d');
  const servers = path.join(configDir, 'servers');

  if (await pathExists(sitesAvailable) || await pathExists(sitesEnabled)) {
    return { mode: 'symlink', configPath: detected.configPath, sitesAvailable, sitesEnabled };
  }
  if (await pathExists(confd)) {
    return { mode: 'single-dir', configPath: detected.configPath, sitesAvailable: confd, sitesEnabled: confd };
  }
  if (isMac || await pathExists(servers)) {
    return { mode: 'single-dir', configPath: detected.configPath, sitesAvailable: servers, sitesEnabled: servers };
  }
  return { mode: 'symlink', configPath: detected.configPath, sitesAvailable, sitesEnabled };
}

function parseSiteConfig(content: string): ParsedSiteConfig {
  const serverName = content.match(/server_name\s+([^;]+);/i)?.[1]?.trim() ?? null;
  const listenLine = content.match(/listen\s+([^;]+);/i)?.[1] ?? null;
  const listenPort = listenLine
    ? Number.parseInt(listenLine.match(/(\d{1,5})/)?.[1] ?? '', 10) || null
    : null;
  const root = content.match(/root\s+([^;]+);/i)?.[1]?.trim() ?? null;
  const sslEnabled = /listen\s+[^;]*\bssl\b/i.test(content)
    || /ssl\s+on\s*;/i.test(content)
    || /ssl_certificate\s+/i.test(content);
  return { serverName, listenPort, root, sslEnabled };
}

function generateSiteConfig(input: CreateNginxSiteInput): string {
  const sslEnabled = !!input.sslEnabled;
  const port = sslEnabled ? 443 : input.listenPort;
  const lines = [
    'server {',
    `    listen ${port}${sslEnabled ? ' ssl' : ''};`,
    `    server_name ${input.serverName};`,
  ];

  if (sslEnabled) {
    if (input.sslCertPath) lines.push(`    ssl_certificate ${input.sslCertPath};`);
    if (input.sslKeyPath) lines.push(`    ssl_certificate_key ${input.sslKeyPath};`);
  }

  if (input.proxyPass) {
    lines.push(
      '',
      '    location / {',
      `        proxy_pass ${input.proxyPass};`,
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '    }',
    );
  } else {
    const rootDir = input.root?.trim() || `/var/www/${input.name}`;
    lines.push(
      `    root ${rootDir};`,
      '    index index.html index.htm;',
      '',
      '    location / {',
      '        try_files $uri $uri/ =404;',
      '    }',
    );
  }

  if (input.extraConfig?.trim()) {
    lines.push('', input.extraConfig.trim());
  }

  lines.push('}');
  return lines.join('\n');
}

async function readSiteStat(targetPath: string): Promise<{ createdAt: string | null; updatedAt: string | null }> {
  const stat = await fsp.stat(targetPath);
  return {
    createdAt: formatNullableDateTime(stat.birthtime),
    updatedAt: formatNullableDateTime(stat.mtime),
  };
}

async function buildSiteData(name: string, enabled: boolean, configPath: string): Promise<NginxSiteData> {
  const content = await fsp.readFile(configPath, 'utf-8');
  const parsed = parseSiteConfig(content);
  const times = await readSiteStat(configPath);
  return {
    name,
    enabled,
    configPath,
    serverName: parsed.serverName,
    listenPort: parsed.listenPort,
    root: parsed.root,
    sslEnabled: parsed.sslEnabled,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
  };
}

async function resolveSymlinkSitePath(layout: Extract<NginxLayout, { mode: 'symlink' }>, name: string): Promise<string> {
  const availablePath = path.join(layout.sitesAvailable, name);
  if (!await pathExists(availablePath)) {
    throw new HTTPException(404, { message: '站点不存在' });
  }
  return availablePath;
}

async function resolveSingleDirSitePath(
  layout: Extract<NginxLayout, { mode: 'single-dir' }>,
  name: string,
): Promise<{ configPath: string; enabled: boolean }> {
  const enabledPath = buildSingleDirEnabledPath(layout.sitesAvailable, name);
  if (await pathExists(enabledPath)) return { configPath: enabledPath, enabled: true };
  const disabledPath = buildSingleDirDisabledPath(layout.sitesAvailable, name);
  if (await pathExists(disabledPath)) return { configPath: disabledPath, enabled: false };
  throw new HTTPException(404, { message: '站点不存在' });
}

async function ensureNginxInstalled(): Promise<void> {
  const detected = await detectNginx();
  if (!detected.installed) {
    throw new HTTPException(400, { message: '未检测到 Nginx 安装' });
  }
}

export async function getNginxInfo(): Promise<NginxInfoData> {
  if (isWindows) return MOCK_INFO;

  const detected = await detectNginx();
  const layout = await resolveNginxLayout();
  let runningStatus: NginxInfoData['runningStatus'] = 'unknown';

  if (process.platform === 'linux' && detected.installed) {
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'nginx'], { timeout: 5000 });
      runningStatus = stdout.trim() === 'active' ? 'running' : 'stopped';
    } catch {
      runningStatus = 'stopped';
    }
  }

  return {
    installed: detected.installed,
    version: detected.version,
    configPath: layout.configPath,
    sitesAvailable: layout.sitesAvailable,
    sitesEnabled: layout.sitesEnabled,
    runningStatus,
  };
}

export async function listNginxSites(): Promise<NginxSiteData[]> {
  if (isWindows) return MOCK_SITES;

  const layout = await resolveNginxLayout();
  if (!layout.sitesAvailable) return [];
  const availableDirExists = await pathExists(layout.sitesAvailable);
  if (!availableDirExists) return [];

  if (layout.mode === 'symlink') {
    const enabledDirExists = await pathExists(layout.sitesEnabled);
    const [availableEntries, enabledEntries] = await Promise.all([
      fsp.readdir(layout.sitesAvailable, { withFileTypes: true }),
      enabledDirExists ? fsp.readdir(layout.sitesEnabled, { withFileTypes: true }) : Promise.resolve([]),
    ]);
    const enabledNames = new Set(
      enabledEntries
        .filter((entry) => entry.isFile() || entry.isSymbolicLink())
        .map((entry) => entry.name),
    );
    const sites = await Promise.all(
      availableEntries
        .filter((entry) => entry.isFile())
        .map((entry) => buildSiteData(entry.name, enabledNames.has(entry.name), path.join(layout.sitesAvailable, entry.name))),
    );
    return sites.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  const entries = await fsp.readdir(layout.sitesAvailable, { withFileTypes: true });
  const sites = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.conf') || entry.name.endsWith('.conf.disabled')))
      .map((entry) => {
        const enabled = entry.name.endsWith('.conf');
        const siteName = enabled
          ? entry.name.replace(/\.conf$/i, '')
          : entry.name.replace(/\.conf\.disabled$/i, '');
        return buildSiteData(siteName, enabled, path.join(layout.sitesAvailable, entry.name));
      }),
  );
  return sites.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export async function getNginxSiteDetail(name: string): Promise<NginxSiteDetailData> {
  validateSiteName(name);
  if (isWindows) {
    const site = MOCK_SITES.find((item) => item.name === name);
    if (!site) throw new HTTPException(404, { message: '站点不存在' });
    return { ...site, content: MOCK_CONFIG };
  }

  const layout = await resolveNginxLayout();
  if (layout.mode === 'mock') {
    const site = MOCK_SITES.find((item) => item.name === name);
    if (!site) throw new HTTPException(404, { message: '站点不存在' });
    return { ...site, content: MOCK_CONFIG };
  }

  if (layout.mode === 'symlink') {
    const configPath = await resolveSymlinkSitePath(layout, name);
    const site = await buildSiteData(name, await pathExists(path.join(layout.sitesEnabled, name)), configPath);
    return { ...site, content: await fsp.readFile(configPath, 'utf-8') };
  }

  const resolved = await resolveSingleDirSitePath(layout, name);
  const site = await buildSiteData(name, resolved.enabled, resolved.configPath);
  return { ...site, content: await fsp.readFile(resolved.configPath, 'utf-8') };
}

export async function createNginxSite(input: CreateNginxSiteInput): Promise<void> {
  validateSiteName(input.name);
  if (isWindows) return;

  await ensureNginxInstalled();
  const layout = await resolveNginxLayout();
  const content = generateSiteConfig(input);

  if (layout.mode === 'symlink') {
    await ensureDir(layout.sitesAvailable);
    const configPath = path.join(layout.sitesAvailable, input.name);
    if (await pathExists(configPath)) throw new HTTPException(400, { message: '站点已存在' });
    await fsp.writeFile(configPath, content, 'utf-8');
    return;
  }

  if (layout.mode === 'single-dir') {
    await ensureDir(layout.sitesAvailable);
    const enabledPath = buildSingleDirEnabledPath(layout.sitesAvailable, input.name);
    const disabledPath = buildSingleDirDisabledPath(layout.sitesAvailable, input.name);
    if (await pathExists(enabledPath) || await pathExists(disabledPath)) {
      throw new HTTPException(400, { message: '站点已存在' });
    }
    await fsp.writeFile(disabledPath, content, 'utf-8');
  }
}

export async function updateNginxSiteContent(name: string, content: string): Promise<void> {
  validateSiteName(name);
  if (isWindows) return;

  const layout = await resolveNginxLayout();
  if (layout.mode === 'symlink') {
    await fsp.writeFile(await resolveSymlinkSitePath(layout, name), content, 'utf-8');
    return;
  }
  if (layout.mode === 'single-dir') {
    const resolved = await resolveSingleDirSitePath(layout, name);
    await fsp.writeFile(resolved.configPath, content, 'utf-8');
  }
}

export async function deleteNginxSite(name: string): Promise<void> {
  validateSiteName(name);
  if (isWindows) return;

  const layout = await resolveNginxLayout();
  if (layout.mode === 'symlink') {
    const configPath = await resolveSymlinkSitePath(layout, name);
    const enabledPath = path.join(layout.sitesEnabled, name);
    if (await pathExists(enabledPath)) await fsp.unlink(enabledPath);
    await fsp.unlink(configPath);
    return;
  }
  if (layout.mode === 'single-dir') {
    const resolved = await resolveSingleDirSitePath(layout, name);
    await fsp.unlink(resolved.configPath);
  }
}

export async function enableNginxSite(name: string): Promise<void> {
  validateSiteName(name);
  if (isWindows) return;

  const layout = await resolveNginxLayout();
  if (layout.mode === 'symlink') {
    await ensureDir(layout.sitesEnabled);
    const configPath = await resolveSymlinkSitePath(layout, name);
    const enabledPath = path.join(layout.sitesEnabled, name);
    if (await pathExists(enabledPath)) return;
    const relativeTarget = path.relative(layout.sitesEnabled, configPath) || configPath;
    await fsp.symlink(relativeTarget, enabledPath);
    return;
  }
  if (layout.mode === 'single-dir') {
    const { configPath, enabled } = await resolveSingleDirSitePath(layout, name);
    if (!enabled) await fsp.rename(configPath, buildSingleDirEnabledPath(layout.sitesAvailable, name));
  }
}

export async function disableNginxSite(name: string): Promise<void> {
  validateSiteName(name);
  if (isWindows) return;

  const layout = await resolveNginxLayout();
  if (layout.mode === 'symlink') {
    const enabledPath = path.join(layout.sitesEnabled, name);
    if (await pathExists(enabledPath)) await fsp.unlink(enabledPath);
    return;
  }
  if (layout.mode === 'single-dir') {
    const { configPath, enabled } = await resolveSingleDirSitePath(layout, name);
    if (enabled) await fsp.rename(configPath, buildSingleDirDisabledPath(layout.sitesAvailable, name));
  }
}

export async function testNginxConfig(): Promise<{ success: boolean; output: string }> {
  if (isWindows) {
    return { success: true, output: 'mock: nginx 未安装，已跳过本地配置检测' };
  }

  await ensureNginxInstalled();
  try {
    const { stdout, stderr } = await execFileAsync('nginx', ['-t'], { timeout: 30000 });
    return { success: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: `${execError.stdout ?? ''}${execError.stderr ?? execError.message ?? ''}`.trim(),
    };
  }
}

export async function reloadNginx(): Promise<void> {
  if (isWindows) return;
  await ensureNginxInstalled();
  await execFileAsync('nginx', ['-s', 'reload'], { timeout: 30000 });
}

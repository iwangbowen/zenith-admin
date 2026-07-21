import path from 'node:path';
import { cmsSlugRegex } from '@zenith/shared';

export const CMS_STATIC_ROOT = process.env.CMS_STATIC_ROOT?.trim()
  ? path.resolve(process.env.CMS_STATIC_ROOT.trim())
  : path.resolve(process.cwd(), 'storage/cms-static');

export function isStrictlyWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function siteStaticDir(siteCode: string): string {
  if (siteCode.length > 50 || !cmsSlugRegex.test(siteCode)) {
    throw new Error('CMS 站点 code 格式无效');
  }
  const dir = path.resolve(CMS_STATIC_ROOT, siteCode);
  if (!isStrictlyWithin(CMS_STATIC_ROOT, dir)) {
    throw new Error('CMS 站点静态目录越界');
  }
  return dir;
}

export function pathToStaticFile(relPath: string): string {
  const normalized = relPath.replaceAll('\\', '/');
  if (normalized.includes('\0') || normalized.includes(':') || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')) {
    throw new Error('CMS 静态路径格式无效');
  }
  const cleaned = normalized.replace(/^\/+/, '');
  const segments = cleaned.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('CMS 静态路径禁止点路径或目录穿越');
  }
  if (cleaned === '' || cleaned === '/') return 'index.html';
  if (cleaned.endsWith('/')) return `${cleaned}index.html`;
  return cleaned;
}

export function resolveStaticFile(siteCode: string, relPath: string): string | null {
  try {
    const dir = siteStaticDir(siteCode);
    const abs = path.resolve(dir, pathToStaticFile(relPath));
    if (!isStrictlyWithin(CMS_STATIC_ROOT, abs) || !isStrictlyWithin(dir, abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * File-level renderer boundary. These modules supply HTML, URLs, frozen reads or front-end tokens.
 * Editorial workflows, reports, media workers and release orchestration cannot affect page bytes.
 * New renderer dependencies must be registered here; unknown themes retain conservative data hashes.
 */
export const CMS_RENDER_RUNTIME_MODULES = new Set([
  'cms-render.service', 'cms-render-pagination', 'cms-render-runtime', 'cms-contents.service', 'cms-contents-query.service', 'cms-contents-internal', 'cms-wall-clock',
  'cms-content-columns', 'cms-channels.service', 'cms-channel-visibility.service', 'cms-urls', 'cms-link.service',
  'cms-resource-refs.service', 'cms-model-field-values', 'cms-models.service', 'cms-friend-links.service',
  'cms-search.service', 'cms-link-words.service', 'cms-interactions.service', 'cms-captcha.service', 'cms-form-captcha.service',
  'cms-comments.service', 'cms-ads.service', 'cms-ad-render-proof', 'cms-forms.service', 'cms-widgets.service',
  'cms-pages.service', 'cms-page-blocks', 'cms-preview', 'cms-html-sanitizer', 'cms-frozen-media',
  'cms-site-inheritance.service', 'cms-site-settings', 'cms-public-settings', 'cms-generation-context', 'cms-generation-read',
  'cms-delivery-markers', 'cms-generation-delivery', 'cms-delivery-state',
  'cms-telemetry-render', 'cms-telemetry-context', 'cms-static.service', 'cms-static-path', 'cms-sitemap', 'cms-build-context',
  'cms-access', 'cms-cache.service', 'cms-captcha-adapter.service', 'cms-content-access.service',
  'cms-content-publish-snapshot.service', 'cms-content-revisions.service', 'cms-design-versions.service',
  'cms-form-pattern', 'cms-form-validation', 'cms-friend-link-groups.service', 'cms-generation-storage.service',
  'cms-page-acl.service', 'cms-search-dictionary', 'cms-site-tree', 'cms-sites.service', 'cms-sensitive-words.service',
  'cms-submit-guard', 'cms-static-build-plan',
  'cms-document.service', 'cms-revision-dependencies.service', 'cms-site-hierarchy-policy', 'cms-cdn-policy', 'cms-word-check.service',
  'cms-content-collections.service',
]);
export function isCmsRenderRuntimeFile(filename: string): boolean {
  return /\.(?:ts|tsx|js|mjs)$/.test(filename) && CMS_RENDER_RUNTIME_MODULES.has(filename.replace(/\.(?:ts|tsx|js|mjs)$/, ''));
}

/** Dependencies imported by mixed read/write service files, used only outside frozen rendering. */
export const CMS_RENDER_NON_OUTPUT_DEPENDENCIES = new Set([
  'cms-ad-events.service', 'cms-telemetry-business', 'cms-collection-state', // Event collection, not page context generation.
  'cms-feedback.service', 'cms-content-lock.service', 'cms-template-refs.service', // Administrative mutations/validation.
  'cms-cdn.service', 'cms-webhook.service', 'cms-widget-tasks', 'cms-public-config-refresh.service', 'cms-publish-outbox.service', // Post-commit dispatch.
  'cms-build-concurrency', 'cms-publish-artifact-tracker', 'cms-release-build-artifacts', 'cms-site-publish-lock.service', 'cms-deployment-storage-state', // Ownership, file integrity and storage lifecycle.
  'cms-page-presets.service', // Combinations are instantiated into page snapshots before rendering.
  'cms-media.service', // Frozen revision preparation; resulting derivative fields enter the persisted content dependency hash.
  'cms-content-change-state', 'cms-vocabularies.service', 'cms-model-compiler', 'cms-components.service',
  'cms-configuration-snapshot.service', 'cms-configuration-drafts.service',
]);

const SHARED_RENDER_MODULES = new Set(['page-image', 'page-block-quality', 'configuration-state', 'constants', 'link', 'resource-selection', 'model-design', 'site-composition', 'cms-media', 'cms-media-validation', 'telemetry', 'document', 'validation', 'design-validation', 'content-revision', 'types',
  // Entity contracts participate in renderer service mapping/defaults; reporting/editorial contracts do not.
  'contents', 'channels', 'pages', 'widgets', 'forms', 'ads', 'interactions', 'resources', 'models', 'search', 'sites', 'words', 'friend-links', 'comments', 'public-cms', 'content-collections', 'channel-visibility']);
export function isCmsSharedRenderFile(filename: string): boolean {
  return /\.(?:ts|tsx|js|mjs)$/.test(filename) && SHARED_RENDER_MODULES.has(filename.replace(/\.(?:ts|tsx|js|mjs)$/, ''));
}
async function hashTree(hash: ReturnType<typeof createHash>, directory: string, label: string, accept: (name: string) => boolean = () => true): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const item of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.isSymbolicLink() || item.name === 'node_modules' || item.name.startsWith('.')) continue;
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) await hashTree(hash, filename, `${label}/${item.name}`, accept);
    else if (/\.(?:ts|tsx|js|mjs|css|json)$/.test(item.name) && !/\.(?:test|d)\./.test(item.name) && item.name !== 'renderer-fingerprint.json' && accept(item.name)) hash.update(`${label}/${item.name}`).update(await fs.readFile(filename));
  }
}

/** Used by both source execution and the post-build fingerprint writer; paths never enter the digest. */
export async function computeCmsRenderRuntimeHash(servicesDirectory: string, sharedDirectory = path.dirname(fileURLToPath(import.meta.resolve('@zenith/shared/cms')))): Promise<string> {
  const hash = createHash('sha256').update('cms-renderer-boundary-v2');
  await hashTree(hash, servicesDirectory, 'render-services', isCmsRenderRuntimeFile);
  await hashTree(hash, path.resolve(servicesDirectory, '../../cms'), 'themes-and-islands');
  await hashTree(hash, sharedDirectory, 'shared-cms', isCmsSharedRenderFile);
  await hashTree(hash, path.resolve(sharedDirectory, '../core'), 'shared-render-kernel');
  await hashTree(hash, path.resolve(servicesDirectory, '../../lib'), 'render-kernel', name => /^(?:datetime|signed-token|where-helpers)\.(?:ts|js)$/.test(name));
  return hash.digest('hex');
}

/** Bundles use a build-time renderer digest plus their actual theme assets, never a backend-wide digest. */
export async function cmsRenderRuntimeHashFromEntry(entry: string): Promise<string> {
  if (['cms-release-build-storage.ts', 'cms-release-build-storage.js'].includes(path.basename(entry))) return computeCmsRenderRuntimeHash(path.dirname(entry));
  const assets = path.join(path.dirname(entry), 'cms');
  try {
    const fingerprint: unknown = JSON.parse(await fs.readFile(path.join(assets, 'renderer-fingerprint.json'), 'utf8'));
    if (!fingerprint || typeof fingerprint !== 'object' || !('version' in fingerprint) || fingerprint.version !== 1 || !('hash' in fingerprint) || typeof fingerprint.hash !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint.hash)) throw new Error('Invalid renderer fingerprint');
    const hash = createHash('sha256').update(fingerprint.hash);
    await hashTree(hash, assets, 'packaged-cms-assets');
    return hash.digest('hex');
  } catch {
    // Old/custom packaging that omitted the manifest must rebuild conservatively, never reuse blindly.
    const hash = createHash('sha256').update(await fs.readFile(entry));
    try { await hashTree(hash, assets, 'packaged-cms-assets'); } catch { /* one-file custom bundles may have no external assets */ }
    return hash.digest('hex');
  }
}

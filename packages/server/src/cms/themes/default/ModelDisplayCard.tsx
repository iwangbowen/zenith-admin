import { CMS_MODEL_DISPLAY_LABELS, CMS_MODEL_DISPLAY_ROLES, cmsModelDisplayFor, isDirectCmsHref, validateCmsModelDisplay } from '@zenith/shared/cms';
import type { CmsDetailContext } from '../types';

function assetUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' && 'url' in value ? String(value.url) : '';
  return raw && isDirectCmsHref(raw) ? raw : null;
}

/** Values come from the content's pinned model revision, never today's editable model schema. */
export function ModelDisplayCard({ ctx }: { ctx: CmsDetailContext }) {
  const binding = cmsModelDisplayFor(ctx.site.themeConfig, ctx.content.modelId);
  if (!binding || validateCmsModelDisplay(binding, { id: binding.modelId, fields: ctx.content.modelFields }).length) return null;
  const fields = new Map(ctx.content.modelFields.map((field) => [field.name, field]));
  const portrait = binding.fields.portrait ? assetUrl(fields.get(binding.fields.portrait)?.rawValue) : null;
  return <section className={`model-display model-display-${binding.kind}`} aria-label={CMS_MODEL_DISPLAY_LABELS[binding.kind]}>
    <h2>{CMS_MODEL_DISPLAY_LABELS[binding.kind]}</h2>
    {portrait ? <img className="model-display-portrait" src={portrait} alt={fields.get(binding.fields.name)?.displayValue ?? ctx.content.title} loading="lazy" /> : null}
    <dl>{CMS_MODEL_DISPLAY_ROLES[binding.kind].filter((role) => role.key !== 'portrait').map((role) => {
      const field = fields.get(binding.fields[role.key]);
      if (!field || !field.displayValue) return null;
      const download = role.key === 'file' ? assetUrl(field.rawValue) : null;
      return <div key={role.key}><dt>{role.label}</dt><dd>{role.key === 'file' ? download ? <a href={download} download target="_blank" rel="noopener">下载{ctx.content.title}</a> : '文件暂不可用' : field.displayValue}</dd></div>;
    })}</dl>
  </section>;
}

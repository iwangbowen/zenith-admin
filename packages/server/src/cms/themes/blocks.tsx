/**
 * 可视化搭建区块渲染器（主题无关）：
 * 每个区块类型对应一个渲染组件，renderBlocksHtml 输出整段 HTML 交给主题 customPage 模板包裹。
 * 区块样式内联 <style>（.pb-* 前缀），静态页零外部依赖。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { CmsFragmentType, CmsPageBlock } from '@zenith/shared';
import type { CmsBaseContext, CmsContentItem } from './types';
import { sanitizeCmsHtml } from '../../services/cms/cms-html-sanitizer';

export const BLOCK_STYLES = `
.pb-hero { text-align: center; padding: 64px 24px; border-radius: 12px; background: var(--bg-2); background-size: cover; background-position: center; margin-bottom: 32px; }
.pb-hero h1 { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; }
.pb-hero p { color: var(--text-2); font-size: 16px; margin-top: 10px; max-width: 620px; margin-left: auto; margin-right: auto; }
.pb-hero.pb-hero-image { color: #fff; }
.pb-hero.pb-hero-image h1 { color: #fff; text-shadow: 0 1px 6px rgba(0,0,0,.5); }
.pb-hero.pb-hero-image p { color: rgba(255,255,255,.9); text-shadow: 0 1px 4px rgba(0,0,0,.5); }
.pb-hero .pb-btn { display: inline-block; margin-top: 20px; background: var(--primary); color: #fff; border-radius: 8px; padding: 10px 28px; font-size: 15px; }
.pb-richtext { margin-bottom: 32px; font-size: 15px; }
.pb-richtext p { margin: 12px 0; }
.pb-image { margin-bottom: 32px; text-align: center; }
.pb-image img { border-radius: 10px; max-width: 100%; }
.pb-section-title { font-size: 20px; font-weight: 700; margin: 0 0 14px; }
.pb-content-list { margin-bottom: 32px; }
.pb-content-list .pb-item { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.pb-content-list .pb-item a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-content-list .pb-item time { color: var(--text-2); font-size: 12px; flex-shrink: 0; }
.pb-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 32px; }
.pb-columns .pb-col { border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
.pb-columns .pb-col h3 { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
.pb-columns .pb-col p { font-size: 13.5px; color: var(--text-2); }
.pb-fragment { margin-bottom: 32px; }
@media (max-width: 768px) { .pb-hero { padding: 40px 16px; } .pb-hero h1 { font-size: 26px; } }
`;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function HeroBlock({ props }: { props: Record<string, unknown> }) {
  const image = str(props.image);
  return (
    <section
      className={`pb-hero${image ? ' pb-hero-image' : ''}`}
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    >
      <h1>{str(props.title)}</h1>
      {str(props.subtitle) ? <p>{str(props.subtitle)}</p> : null}
      {str(props.buttonText) && str(props.buttonUrl) ? (
        <a className="pb-btn" href={str(props.buttonUrl)}>{str(props.buttonText)}</a>
      ) : null}
    </section>
  );
}

function RichtextBlock({ props }: { props: Record<string, unknown> }) {
  return <section className="pb-richtext" dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(str(props.html)) }} />;
}

function ImageBlock({ props }: { props: Record<string, unknown> }) {
  const img = <img src={str(props.src)} alt={str(props.alt)} loading="lazy" />;
  return (
    <section className="pb-image">
      {str(props.linkUrl) ? <a href={str(props.linkUrl)}>{img}</a> : img}
    </section>
  );
}

function ContentListBlock({ props, items }: { props: Record<string, unknown>; items: CmsContentItem[] }) {
  return (
    <section className="pb-content-list">
      {str(props.title) ? <h2 className="pb-section-title">{str(props.title)}</h2> : null}
      {items.length === 0 ? <div style={{ color: 'var(--text-2)', fontSize: 14 }}>暂无内容</div> : items.map((item) => (
        <div className="pb-item" key={item.id}>
          <a href={item.url}>{item.title}</a>
          {item.publishedAt ? <time>{item.publishedAt.slice(0, 10)}</time> : null}
        </div>
      ))}
    </section>
  );
}

function ColumnsBlock({ props }: { props: Record<string, unknown> }) {
  const items = Array.isArray(props.items) ? props.items as { title?: string; description?: string }[] : [];
  return (
    <section className="pb-columns">
      {items.map((col, i) => (
        <div className="pb-col" key={`${col.title ?? ''}-${i}`}>
          <h3>{col.title ?? ''}</h3>
          {col.description ? <p>{col.description}</p> : null}
        </div>
      ))}
    </section>
  );
}

export function CmsFragmentContent({
  fragment,
  className,
  imageAlt,
  as: Wrapper = 'div',
}: {
  fragment: { type: CmsFragmentType | string; content: string } | undefined;
  className?: string;
  imageAlt: string;
  as?: 'div' | 'section';
}) {
  if (!fragment?.content) return null;
  if (fragment.type === 'html') {
    return <Wrapper className={className} dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(fragment.content) }} />;
  }
  if (fragment.type === 'image') {
    return <Wrapper className={className}><img src={fragment.content} alt={imageAlt} /></Wrapper>;
  }
  if (fragment.type === 'text') {
    return <Wrapper className={className}>{fragment.content}</Wrapper>;
  }
  if (fragment.type === 'json') {
    let display = fragment.content;
    try {
      display = JSON.stringify(JSON.parse(fragment.content), null, 2);
    } catch {
      // Legacy invalid JSON remains inert text.
    }
    return <Wrapper className={className}><pre>{display}</pre></Wrapper>;
  }
  return null;
}

function FragmentBlock({ props, ctx }: { props: Record<string, unknown>; ctx: CmsBaseContext }) {
  const code = str(props.code);
  return <CmsFragmentContent fragment={ctx.fragments[code]} className="pb-fragment" imageAlt={code} as="section" />;
}

export interface BlockRenderInput {
  blocks: CmsPageBlock[];
  ctx: CmsBaseContext;
  /** content-list 区块的数据（key = block.id），由 render service 预取 */
  contentListData: Map<string, CmsContentItem[]>;
}

/** 渲染全部区块为 HTML 字符串（含区块样式 <style>） */
export function renderBlocksHtml({ blocks, ctx, contentListData }: BlockRenderInput): string {
  const rendered = blocks.map((block) => {
    switch (block.type) {
      case 'hero':
        return renderToStaticMarkup(<HeroBlock props={block.props} />);
      case 'richtext':
        return renderToStaticMarkup(<RichtextBlock props={block.props} />);
      case 'image':
        return renderToStaticMarkup(<ImageBlock props={block.props} />);
      case 'content-list':
        return renderToStaticMarkup(<ContentListBlock props={block.props} items={contentListData.get(block.id) ?? []} />);
      case 'columns':
        return renderToStaticMarkup(<ColumnsBlock props={block.props} />);
      case 'fragment':
        return renderToStaticMarkup(<FragmentBlock props={block.props} ctx={ctx} />);
      default:
        return '';
    }
  }).join('\n');
  return `<style>${BLOCK_STYLES}</style>\n${rendered}`;
}

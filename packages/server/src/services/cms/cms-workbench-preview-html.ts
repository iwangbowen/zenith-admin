import { load } from 'cheerio';

/** The opaque iframe cannot submit forms, run site scripts or navigate out of its preview context. */
export function prepareCmsWorkbenchHtml(html: string, baseUrl: string): string {
  const $ = load(html);
  $('script,iframe,object,embed,base,meta[http-equiv="refresh"]').remove();
  $('*').each((_index, element) => {
    if ('attribs' in element) for (const key of Object.keys(element.attribs ?? {})) if (/^on/i.test(key)) $(element).removeAttr(key);
  });
  $('form').removeAttr('action').removeAttr('method').attr('data-preview-readonly', 'true');
  $('input,textarea,select,button').attr('disabled', 'disabled');
  $('a').each((_index, element) => {
    const href = $(element).attr('href') ?? '';
    if (href.startsWith('#')) return;
    if (href === baseUrl || href.startsWith(`${baseUrl}/`) || href.startsWith(`${baseUrl}?`)) {
      const relative = href.slice(baseUrl.length) || '/';
      $(element).attr('data-cms-preview-path', relative.startsWith('?') ? `/${relative}` : relative).attr('href', '#');
    } else {
      $(element).removeAttr('href').attr('aria-disabled', 'true').attr('title', '预览模式不执行外部跳转或下载');
    }
    $(element).removeAttr('target');
  });
  $('head').append('<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">');
  return $.html();
}

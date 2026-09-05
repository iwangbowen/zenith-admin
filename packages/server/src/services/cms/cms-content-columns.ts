/**
 * cms_contents 的读投影分层。
 *
 * 全行（`CmsContentRow`）里有 5 个 TOAST 大列：`body`、`search_vector`、`extend`、`media_data`、`attachments`，
 * 其中前两个常常各占几十 KB。列表类读路径只需要标题 / 导语 / 封面 / 标志位 / URL 片段，
 * 用全行当通用货币意味着每行多解压、多传输、多正则扫描 40–150 倍的数据。
 *
 * - `cmsContentListColumns`：前台列表、首页区块、标签页、主题数据门面、部件内容源、RSS、Open API 列表
 *   （保留 `extend` / `mediaData`：列表要显示 showInList 模型字段与图集张数 / 媒体类型）；
 * - `cmsContentLinkColumns`：只为拼「标题 + 链接」的场合（上下篇、相关文章、链接目标）。
 *
 * 函数签名收窄到对应行类型后，任何想在列表里读 `body` 的代码都在编译期失败。
 */
import { getTableColumns } from 'drizzle-orm';
import { cmsContents } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';

const {
  body: _body,
  searchVector: _searchVector,
  attachments: _attachments,
  ...listColumns
} = getTableColumns(cmsContents);

export const cmsContentListColumns = listColumns;

export const cmsContentLinkColumns = {
  id: cmsContents.id,
  siteId: cmsContents.siteId,
  channelId: cmsContents.channelId,
  title: cmsContents.title,
  slug: cmsContents.slug,
  staticPath: cmsContents.staticPath,
  externalLink: cmsContents.externalLink,
  publishedAt: cmsContents.publishedAt,
  createdAt: cmsContents.createdAt,
};

export type CmsContentListRow = { [K in keyof typeof cmsContentListColumns]: CmsContentRow[K] };
export type CmsContentLinkRow = { [K in keyof typeof cmsContentLinkColumns]: CmsContentRow[K] };

/**
 * 列表 / 搜索 / RSS 展示用导语：手填摘要优先，否则用数据库生成列 `excerpt`（正文纯文本前 400 字）。
 * 这是列表读路径不依赖 `body` 的唯一前提，所有「摘要为空时回退正文」的逻辑只能经过这里。
 */
export function listSummaryOf(row: Pick<CmsContentRow, 'summary' | 'excerpt'>, maxLength = 400): string | null {
  const summary = row.summary?.trim();
  if (summary) return row.summary;
  const excerpt = row.excerpt?.trim();
  return excerpt ? excerpt.slice(0, maxLength) : null;
}

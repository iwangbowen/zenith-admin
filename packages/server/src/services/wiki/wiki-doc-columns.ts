import { getTableColumns } from 'drizzle-orm';
import { wikiDocs, type WikiDocRow } from '../../db/schema';

/** Metadata-only read paths must not fetch or decode the Markdown body. */
const { content: _content, ...columns } = getTableColumns(wikiDocs);
export const wikiDocListColumns = columns;
export type WikiDocListRow = Omit<WikiDocRow, 'content'>;

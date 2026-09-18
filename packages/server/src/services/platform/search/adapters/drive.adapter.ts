import { driveRoleAtLeast } from '@zenith/shared/drive';
import { hasPermission } from '../../../../lib/context';
import { searchDriveNodes } from '../../../drive/drive-views.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const driveSearchAdapter: GlobalSearchAdapter = {
  type: 'file',
  permissions: ['drive:node:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('drive:node:list'))) return [];
    const page = await searchDriveNodes({ page: 1, pageSize: limit, keyword: q, fullText: false });
    const canDownload = await hasPermission('drive:node:download');
    return page.list.map((node) => result({
      type: 'file',
      id: String(node.id),
      title: node.name,
      subtitle: [node.spaceName, node.type === 'folder' ? '文件夹' : node.extension ? `.${node.extension}` : '文件'].filter(Boolean).join(' · '),
      description: node.snippet,
      icon: node.type === 'folder' ? 'Folder' : 'FileText',
      route: `/drive?space=${node.spaceId}&node=${node.id}`,
      highlights: node.snippet ? [{ field: 'snippet', text: node.snippet }] : [],
      actions: { view: true, download: canDownload && driveRoleAtLeast(node.myRole, 'downloader') },
    }));
  },
};


import { useState } from 'react';
import { Banner } from '@douyinfe/semi-ui';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { CmsSiteSelect } from './CmsSiteSelect';
import CmsEditorialWorkspace from './CmsEditorialWorkspace';

/** CMS 内容工作台：汇总当前站点的编辑待办、读者反馈与编辑事项。 */
export default function CmsWorkspacePage() {
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { hasPermission, hasAnyPermission } = usePermission();
  const canListSites = hasPermission('cms:site:list');
  const canViewWorkQueues = hasAnyPermission('cms:content:list', 'cms:form:list', 'cms:editorial-task:manage');
  const canOpenWorkspace = canListSites && canViewWorkQueues;

  return (
    <div className="page-container zx-flat-panels">
      {canListSites ? (
        <SearchToolbar>
          <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
        </SearchToolbar>
      ) : null}
      {canOpenWorkspace ? (
        <CmsEditorialWorkspace siteId={siteId} />
      ) : (
        <Banner
          type="warning"
          description="需要站点查询权限，以及内容查询、表单查询或编辑事项管理权限，才能使用内容工作台。"
        />
      )}
    </div>
  );
}

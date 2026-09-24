import { Banner, Button, Space } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { useCmsConfigurationDraft } from '@/hooks/queries/cms-workbench';

export default function CmsConfigurationNotice({ siteId }: Readonly<{ siteId?: number }>) {
  const draft = useCmsConfigurationDraft(siteId);
  const navigate = useNavigate();
  return <Banner type="info" style={{ marginBottom: 12 }} description={<Space wrap><span>保存更新工作配置，构建并激活发布单后才改变线上页面。</span>
    {draft.data ? <Button size="small" onClick={() => navigate(draft.data!.href)}>审阅待发布配置 #{draft.data.id}</Button> : null}
  </Space>} />;
}

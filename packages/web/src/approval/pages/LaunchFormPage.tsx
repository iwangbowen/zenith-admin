import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, Empty, Input, Skeleton, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ChevronLeft } from 'lucide-react';
import dayjs from 'dayjs';
import { applyFieldPermissionsToFields } from '@zenith/shared';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { canLaunchOnMobile } from '../lib/launch';
import { useApprovalMe, useLaunchInstance, usePublishedDefinitions } from '../lib/queries';

export default function LaunchFormPage() {
  const navigate = useNavigate();
  const { definitionId } = useParams<{ definitionId: string }>();
  const defsQuery = usePublishedDefinitions();
  const meQuery = useApprovalMe();
  const launchMutation = useLaunchInstance();
  const formApi = useRef<FormApi | null>(null);

  const def = useMemo(
    () => (defsQuery.data ?? []).find((d) => d.id === Number(definitionId)) ?? null,
    [defsQuery.data, definitionId],
  );

  const defaultTitle = useMemo(() => {
    const who = meQuery.data?.nickname || meQuery.data?.username || '';
    return def ? `${def.name} - ${who} - ${dayjs().format('MM-DD HH:mm')}` : '';
  }, [def, meQuery.data]);
  const [title, setTitle] = useState<string | null>(null);

  const launchFields = useMemo(() => {
    if (!def) return [];
    const startPerms = def.flowData?.nodes.find((n) => n.data.type === 'start')?.data.fieldPermissions;
    return applyFieldPermissionsToFields(def.formFields ?? [], startPerms);
  }, [def]);

  const submit = async () => {
    if (!def || launchMutation.isPending) return;
    try {
      const formData = (await formApi.current?.validate() ?? {}) as Record<string, unknown>;
      await launchMutation.mutateAsync({
        definitionId: def.id,
        title: (title ?? defaultTitle).trim() || defaultTitle,
        formData,
        priority: 'normal',
      });
      Toast.success('提交成功');
      navigate('/', { replace: true });
    } catch { /* 校验或请求失败（request 层已 Toast） */ }
  };

  const renderBody = () => {
    if (defsQuery.isLoading) return <Skeleton placeholder={<Skeleton.Paragraph rows={5} />} loading active />;
    if (!def) return <Empty description="流程不存在或未发布" style={{ paddingTop: 60 }} />;
    if (!canLaunchOnMobile(def)) {
      return <Banner type="warning" closeIcon={null} description="该流程包含业务表单或需要发起人指定审批人，请到桌面端发起。" />;
    }
    return (
      <>
        <div className="ap-section-title">申请标题</div>
        <Input value={title ?? defaultTitle} onChange={setTitle} showClear placeholder="请输入申请标题" />
        <div className="ap-section-title">表单信息</div>
        {launchFields.length === 0
          ? <Typography.Text type="tertiary">该流程无需填写表单，直接提交即可</Typography.Text>
          : (
            <WorkflowFormRenderer
              key={`launch-${def.id}`}
              fields={launchFields}
              getFormApi={(api) => { formApi.current = api; }}
            />
          )}
      </>
    );
  };

  const canSubmit = def != null && canLaunchOnMobile(def);

  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">{def?.name ?? '发起申请'}</span>
      </div>
      <div className={`ap-body${canSubmit ? ' ap-body--with-footer' : ''}`}>{renderBody()}</div>
      {canSubmit && (
        <div className="ap-footer-bar">
          <Button theme="solid" type="primary" loading={launchMutation.isPending} onClick={() => void submit()}>
            提交申请
          </Button>
        </div>
      )}
    </div>
  );
}

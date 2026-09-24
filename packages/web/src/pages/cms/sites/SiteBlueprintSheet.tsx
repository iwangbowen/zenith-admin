import { useRef } from 'react';
import { Banner, Form, SideSheet, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { CMS_SITE_BLUEPRINTS, type CmsSiteBlueprintInput } from '@zenith/shared/cms';
import { useCreateCmsSiteFromBlueprint } from '@/hooks/queries/cms-sites';
import { ModalFooter } from '@/components/ModalFooter';

export default function SiteBlueprintSheet({ visible, onClose, onCreated }: Readonly<{ visible: boolean; onClose: () => void; onCreated: (id: number) => void }>) {
  // Composite creation wizard: a new site and its graph are created atomically.
  const form = useRef<FormApi | null>(null);
  const create = useCreateCmsSiteFromBlueprint();
  const submit = async () => {
    const values = await form.current?.validate().catch(() => undefined);
    if (!values) return;
    const result = await create.mutateAsync({ body: values as CmsSiteBlueprintInput });
    Toast.success(`已创建「${result.siteName}」：${result.counts.channels} 个栏目、${result.counts.models} 个模型、${result.counts.pages} 个页面。请继续补充内容并审阅发布。`);
    onCreated(result.siteId); onClose();
  };
  return <SideSheet title="从蓝图建站" visible={visible} onCancel={onClose} width={640} footer={<ModalFooter onCancel={onClose} onOk={() => void submit()} loading={create.isPending} okText="创建站点配置" />}>
    <Banner type="info" description="蓝图准备默认主题、栏目、模型、页面、常用部件和反馈表单。完成内容编辑后，通过发布单审阅并上线。" />
    <Form key={String(visible)} initValues={{ blueprint: 'culture-portal' }} getFormApi={(api) => { form.current = api; }} labelPosition="top">
      <Form.Select field="blueprint" label="建站蓝图" style={{ width: '100%' }} optionList={CMS_SITE_BLUEPRINTS.map((item) => ({ value: item.code, label: item.name }))} rules={[{ required: true }]} />
      <Form.Input field="name" label="站点名称" maxLength={100} rules={[{ required: true, message: '请填写站点名称' }]} />
      <Form.Input field="code" label="站点标识" extraText="小写字母、数字和中划线，用于站点访问路径。" maxLength={44} rules={[{ required: true, message: '请填写站点标识' }, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '请输入有效标识' }]} />
    </Form>
  </SideSheet>;
}

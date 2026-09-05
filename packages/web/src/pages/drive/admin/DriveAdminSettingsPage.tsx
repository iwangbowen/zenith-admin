import { useEffect, useState } from 'react';
import { Button, Divider, Input, InputNumber, Spin, Switch, Toast, Typography } from '@douyinfe/semi-ui';
import type { ReactNode } from 'react';
import type { DriveSettings } from '@zenith/shared/drive';
import { usePermission } from '@/hooks/usePermission';
import { useDriveSettings, useSaveDriveSettings } from '@/hooks/queries/drive';

const { Text, Title } = Typography;

function SettingRow({ title, description, control }: { readonly title: string; readonly description: string; readonly control: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0' }}>
      <div style={{ minWidth: 0 }}>
        <Title heading={6} style={{ margin: 0 }}>{title}</Title>
        <Text type="tertiary" size="small">{description}</Text>
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function SectionTitle({ children }: { readonly children: ReactNode }) {
  return <Title heading={6} style={{ margin: '24px 0 4px', color: 'var(--semi-color-text-2)', fontWeight: 600 }}>{children}</Title>;
}

const DEFAULTS: DriveSettings = {
  personalQuotaGb: 10, departmentQuotaGb: 100, teamQuotaGb: 50, departmentSpaceAutoCreate: true,
  recycleRetentionDays: 30, maxVersions: 20, quotaWarningPercent: 90,
  externalShareEnabled: true, externalShareMaxDays: 30, externalShareRequirePassword: false,
  blockedExtensions: 'exe,bat,cmd,com,msi,scr,ps1,vbs,js,jar,sh', thumbnailEnabled: true, textIndexEnabled: true,
};

export default function DriveAdminSettingsPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('drive:setting:edit');
  const query = useDriveSettings();
  const save = useSaveDriveSettings();
  const [form, setForm] = useState<DriveSettings>(DEFAULTS);
  useEffect(() => { if (query.data) setForm(query.data); }, [query.data]);
  const patch = <K extends keyof DriveSettings>(key: K, value: DriveSettings[K]) => setForm((p) => ({ ...p, [key]: value }));
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  const handleSave = () => {
    save.mutate({ body: form }, { onSuccess: () => Toast.success('设置已保存') });
  };

  return (
    <div className="page-container">
      <Spin spinning={query.isPending}>
        <div style={{ maxWidth: 680 }}>
          <div style={{ marginBottom: 8 }}>
            <Title heading={5} style={{ margin: 0 }}>网盘设置</Title>
            <Text type="tertiary">容量配额、版本与回收策略、外链安全与内容处理</Text>
          </div>

          <SectionTitle>容量配额（GB，0 = 不限）</SectionTitle>
          <SettingRow title="个人空间默认配额" description="新建及未单独设置配额的个人空间生效" control={<InputNumber style={{ width: 140 }} min={0} precision={2} disabled={!canEdit} value={form.personalQuotaGb} onChange={(v) => patch('personalQuotaGb', num(v, 0))} suffix="GB" />} />
          <Divider margin={0} />
          <SettingRow title="部门空间默认配额" description="部门空间未单独设置配额时生效" control={<InputNumber style={{ width: 140 }} min={0} precision={2} disabled={!canEdit} value={form.departmentQuotaGb} onChange={(v) => patch('departmentQuotaGb', num(v, 0))} suffix="GB" />} />
          <Divider margin={0} />
          <SettingRow title="协作空间默认配额" description="协作空间未单独设置配额时生效" control={<InputNumber style={{ width: 140 }} min={0} precision={2} disabled={!canEdit} value={form.teamQuotaGb} onChange={(v) => patch('teamQuotaGb', num(v, 0))} suffix="GB" />} />
          <Divider margin={0} />
          <SettingRow title="配额预警阈值" description="用量达到该百分比时通知空间管理者" control={<InputNumber style={{ width: 140 }} min={50} max={100} disabled={!canEdit} value={form.quotaWarningPercent} onChange={(v) => patch('quotaWarningPercent', num(v, 90))} suffix="%" />} />
          <Divider margin={0} />
          <SettingRow title="自动创建部门空间" description="用户首次访问网盘时，为其所属部门自动创建部门空间" control={<Switch disabled={!canEdit} checked={form.departmentSpaceAutoCreate} onChange={(v) => patch('departmentSpaceAutoCreate', v)} />} />

          <SectionTitle>版本与回收</SectionTitle>
          <SettingRow title="最多保留版本数" description="超出时自动清理最早的历史版本并释放容量；空间可单独覆盖" control={<InputNumber style={{ width: 140 }} min={1} max={200} disabled={!canEdit} value={form.maxVersions} onChange={(v) => patch('maxVersions', num(v, 20))} suffix="个" />} />
          <Divider margin={0} />
          <SettingRow title="回收站保留天数" description="超期项目由每日治理任务彻底删除；0 表示永久保留" control={<InputNumber style={{ width: 140 }} min={0} max={3650} disabled={!canEdit} value={form.recycleRetentionDays} onChange={(v) => patch('recycleRetentionDays', num(v, 30))} suffix="天" />} />

          <SectionTitle>外链分享</SectionTitle>
          <SettingRow title="允许外链分享" description="关闭后全站禁止创建新外链，已有外链仍按各自状态生效" control={<Switch disabled={!canEdit} checked={form.externalShareEnabled} onChange={(v) => patch('externalShareEnabled', v)} />} />
          <Divider margin={0} />
          <SettingRow title="外链最长有效期" description="创建外链时必须设置不超过该天数的过期时间；0 表示允许永久有效" control={<InputNumber style={{ width: 140 }} min={0} max={3650} disabled={!canEdit} value={form.externalShareMaxDays} onChange={(v) => patch('externalShareMaxDays', num(v, 30))} suffix="天" />} />
          <Divider margin={0} />
          <SettingRow title="外链必须设置密码" description="开启后不允许创建无密码的外链" control={<Switch disabled={!canEdit} checked={form.externalShareRequirePassword} onChange={(v) => patch('externalShareRequirePassword', v)} />} />

          <SectionTitle>内容处理</SectionTitle>
          <SettingRow title="禁止上传的扩展名" description="逗号分隔；同时对可执行文件做文件头识别，不受改名影响" control={<Input style={{ width: 280 }} disabled={!canEdit} value={form.blockedExtensions} onChange={(v) => patch('blockedExtensions', v)} placeholder="exe,bat,cmd" />} />
          <Divider margin={0} />
          <SettingRow title="生成缩略图" description="图片上传后异步生成缩略图，用于网格视图预览" control={<Switch disabled={!canEdit} checked={form.thumbnailEnabled} onChange={(v) => patch('thumbnailEnabled', v)} />} />
          <Divider margin={0} />
          <SettingRow title="全文索引" description="提取文档正文建立全文索引，支持按内容搜索；关闭后仅按文件名搜索" control={<Switch disabled={!canEdit} checked={form.textIndexEnabled} onChange={(v) => patch('textIndexEnabled', v)} />} />

          {canEdit && (
            <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
              <Button theme="solid" loading={save.isPending} onClick={handleSave}>保存设置</Button>
              <Button onClick={() => { if (query.data) setForm(query.data); }} disabled={save.isPending}>重置</Button>
            </div>
          )}
        </div>
      </Spin>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Button, InputNumber, Spin, Switch, TagInput, Toast, Typography } from '@douyinfe/semi-ui';
import { driveSettingsSchema, type DriveSettings } from '@zenith/shared/settings';
import { usePermission } from '@/hooks/usePermission';
import { useDriveSettings, useSaveDriveSettings } from '@/hooks/queries/drive';
import { SettingDivider, SettingRow, SettingSection } from '@/components/settings/SettingRow';
import { ApiError } from '@/lib/query';

const { Text, Title } = Typography;

/** 默认值以 shared schema 为唯一真相 */
const DEFAULTS: DriveSettings = driveSettingsSchema.parse({});

/** 页面级全局配置表单（无弹窗、保存后不关闭），不走 useEditModal；设置由运行时设置 drive 模块承载 */
export default function DriveAdminSettingsPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('drive:setting:edit');
  const query = useDriveSettings();
  const save = useSaveDriveSettings();
  const envelope = query.data;
  const [form, setForm] = useState<DriveSettings>(DEFAULTS);
  useEffect(() => { if (envelope) setForm(envelope.effective); }, [envelope]);
  const patch = <K extends keyof DriveSettings>(key: K, value: DriveSettings[K]) => setForm((p) => ({ ...p, [key]: value }));
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const overridden = (key: keyof DriveSettings) => !!envelope && JSON.stringify(envelope.effective[key]) !== JSON.stringify(envelope.inherited[key]);

  const handleSave = async () => {
    const parsed = driveSettingsSchema.safeParse(form);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      Toast.error(`${issue.path.join('.')}：${issue.message}`);
      return;
    }
    try {
      await save.mutateAsync({ body: { version: envelope?.version ?? 0, data: parsed.data } });
      Toast.success('设置已保存');
    } catch (err) {
      // 409 = 他人已修改：请求层已提示，重载最新值供比对后再保存
      if (err instanceof ApiError && err.code === 409) void query.refetch();
    }
  };

  return (
    <div className="page-container">
      <Spin spinning={query.isPending}>
        <div style={{ maxWidth: 680 }}>
          <div style={{ marginBottom: 8 }}>
            <Title heading={5} style={{ margin: 0 }}>网盘设置</Title>
            <Text type="tertiary">容量配额、版本与回收策略、外链安全与内容处理</Text>
          </div>

          <SettingSection title="容量配额（GB，0 = 不限）">
            <SettingRow title="个人空间默认配额" description="新建及未单独设置配额的个人空间生效" overridden={overridden('personalQuotaGb')} control={<InputNumber style={{ width: 140 }} min={0} precision={2} disabled={!canEdit} value={form.personalQuotaGb} onChange={(v) => patch('personalQuotaGb', num(v, 0))} suffix="GB" />} />
            <SettingDivider />
            <SettingRow title="部门空间默认配额" description="部门空间未单独设置配额时生效" overridden={overridden('departmentQuotaGb')} control={<InputNumber style={{ width: 140 }} min={0} precision={2} disabled={!canEdit} value={form.departmentQuotaGb} onChange={(v) => patch('departmentQuotaGb', num(v, 0))} suffix="GB" />} />
            <SettingDivider />
            <SettingRow title="协作空间默认配额" description="协作空间未单独设置配额时生效" overridden={overridden('teamQuotaGb')} control={<InputNumber style={{ width: 140 }} min={0} precision={2} disabled={!canEdit} value={form.teamQuotaGb} onChange={(v) => patch('teamQuotaGb', num(v, 0))} suffix="GB" />} />
            <SettingDivider />
            <SettingRow title="配额预警阈值" description="用量达到该百分比时通知空间管理者" overridden={overridden('quotaWarningPercent')} control={<InputNumber style={{ width: 140 }} min={50} max={100} disabled={!canEdit} value={form.quotaWarningPercent} onChange={(v) => patch('quotaWarningPercent', num(v, 90))} suffix="%" />} />
            <SettingDivider />
            <SettingRow title="自动创建部门空间" description="用户首次访问网盘时，为其所属部门自动创建部门空间" overridden={overridden('departmentSpaceAutoCreate')} control={<Switch disabled={!canEdit} checked={form.departmentSpaceAutoCreate} onChange={(v) => patch('departmentSpaceAutoCreate', v)} />} />
          </SettingSection>

          <SettingSection title="版本与回收">
            <SettingRow title="最多保留版本数" description="超出时自动清理最早的历史版本并释放容量；空间可单独覆盖" overridden={overridden('maxVersions')} control={<InputNumber style={{ width: 140 }} min={1} max={200} disabled={!canEdit} value={form.maxVersions} onChange={(v) => patch('maxVersions', num(v, 20))} suffix="个" />} />
            <SettingDivider />
            <SettingRow title="回收站保留天数" description="超期项目由每日治理任务彻底删除；0 表示永久保留" overridden={overridden('recycleRetentionDays')} control={<InputNumber style={{ width: 140 }} min={0} max={3650} disabled={!canEdit} value={form.recycleRetentionDays} onChange={(v) => patch('recycleRetentionDays', num(v, 30))} suffix="天" />} />
          </SettingSection>

          <SettingSection title="外链分享">
            <SettingRow title="允许外链分享" description="关闭后全站禁止创建新外链，已有外链仍按各自状态生效" overridden={overridden('externalShareEnabled')} control={<Switch disabled={!canEdit} checked={form.externalShareEnabled} onChange={(v) => patch('externalShareEnabled', v)} />} />
            <SettingDivider />
            <SettingRow title="外链最长有效期" description="创建外链时必须设置不超过该天数的过期时间；0 表示允许永久有效" overridden={overridden('externalShareMaxDays')} control={<InputNumber style={{ width: 140 }} min={0} max={3650} disabled={!canEdit} value={form.externalShareMaxDays} onChange={(v) => patch('externalShareMaxDays', num(v, 30))} suffix="天" />} />
            <SettingDivider />
            <SettingRow title="外链必须设置密码" description="开启后不允许创建无密码的外链" overridden={overridden('externalShareRequirePassword')} control={<Switch disabled={!canEdit} checked={form.externalShareRequirePassword} onChange={(v) => patch('externalShareRequirePassword', v)} />} />
          </SettingSection>

          <SettingSection title="内容处理">
            <SettingRow
              title="禁止上传的扩展名"
              description="不区分大小写，可带或不带前导点；同时对可执行文件做文件头识别，不受改名影响"
              overridden={overridden('blockedExtensions')}
              control={(
                <TagInput
                  style={{ width: 320, maxWidth: '100%' }}
                  disabled={!canEdit}
                  value={form.blockedExtensions}
                  allowDuplicates={false}
                  separator={[',', ' ', '\n']}
                  addOnBlur
                  placeholder="输入扩展名后回车，如 exe"
                  onChange={(v) => patch('blockedExtensions', v)}
                />
              )}
            />
            <SettingDivider />
            <SettingRow title="生成缩略图" description="图片上传后异步生成缩略图，用于网格视图预览" overridden={overridden('thumbnailEnabled')} control={<Switch disabled={!canEdit} checked={form.thumbnailEnabled} onChange={(v) => patch('thumbnailEnabled', v)} />} />
            <SettingDivider />
            <SettingRow title="全文索引" description="提取文档正文建立全文索引，支持按内容搜索；关闭后仅按文件名搜索" overridden={overridden('textIndexEnabled')} control={<Switch disabled={!canEdit} checked={form.textIndexEnabled} onChange={(v) => patch('textIndexEnabled', v)} />} />
          </SettingSection>

          {canEdit && (
            <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
              <Button theme="solid" loading={save.isPending} onClick={() => void handleSave()}>保存设置</Button>
              <Button onClick={() => { if (envelope) setForm(envelope.effective); }} disabled={save.isPending}>重置</Button>
            </div>
          )}
        </div>
      </Spin>
    </div>
  );
}
import { useState } from 'react';
import { Banner, Button, Card, Collapse, Input, Modal, Space, Spin, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { evaluateIpAccess, inspectIpList, ipAccessSettingsSchema, ipRangesOverlap, stableSettingsSerialize } from '@zenith/shared/settings';
import { SchemaForm } from '@/components/settings/SchemaForm';
import { SettingsEditorTools } from '@/components/settings/SettingsEditorTools';
import { useSettingsEditor } from '@/hooks/useSettingsEditor';
import { usePermission } from '@/hooks/usePermission';
import { useSaveSettings, useSettings } from '@/hooks/queries/settings';
import { useIpAccessContext, useDiagnoseIpAccess } from '@/hooks/queries/ip-access';
import './ip-access.css';
const { Text } = Typography;

export default function IpAccessConfig() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('system:ip-access:update');
  const configs = useSettings('ipAccess');
  const saveMutation = useSaveSettings('ipAccess');
  const editor = useSettingsEditor('ipAccess', configs.data);
  const context = useIpAccessContext();
  const diagnose = useDiagnoseIpAccess();
  const [testIp, setTestIp] = useState('');
  const [diagnosedKey, setDiagnosedKey] = useState('');
  const textKey = editor.base?.baseToken + ':' + editor.resetKey;
  const [textDraft, setTextDraft] = useState<{ key: string; whitelist?: string; blacklist?: string }>({ key: '' });
  const textFor = (key: 'whitelist' | 'blacklist') => textDraft.key === textKey && textDraft[key] !== undefined ? textDraft[key]! : editor.value[key].join('\n');
  const parsed = ipAccessSettingsSchema.safeParse(editor.value);
  const currentDecision = context.data && parsed.success ? evaluateIpAccess(parsed.data, context.data.clientIp) : null;
  const draftKey = stableSettingsSerialize({ value: editor.value, baseToken: editor.base?.baseToken, latestToken: configs.data?.baseToken, testIp });
  const overlap = parsed.success && parsed.data.whitelistEnabled && parsed.data.blacklistEnabled
    ? parsed.data.whitelist.find((allow) => parsed.data.blacklist.some((deny) => ipRangesOverlap(allow, deny))) : null;
  const updateList = (key: 'whitelist' | 'blacklist', text: string) => {
    setTextDraft((current) => ({ ...(current.key === textKey ? current : { key: textKey }), [key]: text }));
    editor.setField(key, text.split('\n').map((line) => line.trim()).filter(Boolean));
  };
  const runDiagnosis = async () => {
    if (!parsed.success || !editor.base) return;
    const key = draftKey;
    try {
      await diagnose.mutateAsync({ body: { policy: parsed.data, baseToken: editor.base.baseToken, ...(testIp.trim() ? { ip: testIp.trim() } : {}) } });
      setDiagnosedKey(key);
    } catch { /* Request errors are already surfaced; stale results remain marked. */ }
  };
  const saveSettings = async () => {
    if (await editor.save((body) => saveMutation.mutateAsync({ body }))) {
      Toast.success('访问控制设置已保存');
      void context.refetch();
    }
  };
  const renderList = (key: 'whitelist' | 'blacklist', disabled?: boolean) => {
    const text = textFor(key);
    const analysis = inspectIpList(text);
    return <div className="ip-access-list-editor">
      <TextArea aria-label={key === 'whitelist' ? '白名单地址' : '黑名单地址'} value={text} rows={5} maxLength={65_000} disabled={disabled}
        placeholder="每行一条 IP 或 CIDR，支持 IPv4 / IPv6" onChange={(next) => updateList(key, next)} />
      <Space wrap style={{ marginTop: 8 }}>
        <Text type="tertiary" size="small">{analysis.entries.length} / 1000 个有效地址</Text>
        {analysis.duplicates > 0 ? <Tag color="orange">{analysis.duplicates} 条重复地址</Tag> : null}
        <Button size="small" disabled={disabled || !text.trim() || analysis.invalid.length > 0} onClick={() => updateList(key, analysis.entries.join('\n'))}>整理并去重</Button>
        {key === 'whitelist' && context.data ? <Button size="small" disabled={disabled} onClick={() => updateList(key, [text, context.data!.clientIp].filter(Boolean).join('\n'))}>加入当前 IP</Button> : null}
      </Space>
      {analysis.invalid.slice(0, 8).map((issue) => <div key={issue.line}><Text type="danger" size="small">第 {issue.line} 行：{issue.value} 不是有效地址</Text></div>)}
      {analysis.invalid.length > 8 ? <Text type="danger" size="small">另有 {analysis.invalid.length - 8} 行无效地址</Text> : null}
    </div>;
  };
  if (configs.isLoading) return <Spin size="large" />;
  if (configs.isError) return <Card><Text type="danger">无法读取访问控制设置</Text><Button onClick={() => void configs.refetch()}>重试</Button></Card>;
  return <div className="ip-access-config">
    <Card>
      <Space wrap>
        <Text strong>当前来源 IP：{context.data?.clientIp ?? (context.isError ? '读取失败' : '读取中')}</Text>
        <Tag color={editor.value.whitelistEnabled || editor.value.blacklistEnabled ? 'blue' : 'grey'}>{editor.value.whitelistEnabled || editor.value.blacklistEnabled ? '草稿已启用访问控制' : '草稿未启用访问控制'}</Tag>
        <Tag>黑名单优先</Tag>
        {context.isError ? <Button size="small" onClick={() => void context.refetch()}>重试来源检测</Button> : null}
      </Space>
      <div style={{ marginTop: 8 }}><Text type="tertiary" size="small">API 统一生效，包含登录、公开接口及 WebSocket 握手；可信代理由部署配置管理。</Text></div>
    </Card>
    <SettingsEditorTools module="ipAccess" editor={editor} canWrite={canUpdate} saving={saveMutation.isPending} onReload={configs.refetch} />
    {!parsed.success ? <Banner type="danger" closeIcon={null} description={parsed.error.issues[0].message} /> : null}
    {currentDecision && !currentDecision.allowed ? <Banner type="danger" closeIcon={null} description="当前草稿会阻断你的来源 IP，无法保存。请先调整名单。" /> : null}
    {overlap ? <Banner type="warning" closeIcon={null} description={'黑白名单存在重叠（' + overlap + '），重叠范围按黑名单拒绝。'} /> : null}
    <Card>
      <SchemaForm schema={ipAccessSettingsSchema} value={editor.value} onFieldChange={editor.setField} disabled={!canUpdate || saveMutation.isPending}
        overriddenPaths={editor.overriddenPaths} onRevert={editor.revert}
        controls={{ whitelist: ({ disabled }) => renderList('whitelist', disabled), blacklist: ({ disabled }) => renderList('blacklist', disabled) }} />
    </Card>
    <Collapse>
      <Collapse.Panel header="匹配诊断" itemKey="diagnose">
        <Space wrap>
          <Input aria-label="待诊断 IP" value={testIp} onChange={setTestIp} placeholder="留空诊断当前来源 IP" style={{ width: 280 }} />
          <Button loading={diagnose.isPending} disabled={!parsed.success || editor.stale || editor.conflict} onClick={() => void runDiagnosis()}>诊断草稿</Button>
        </Space>
        {diagnose.data ? <div style={{ marginTop: 12 }}>
          {diagnosedKey !== draftKey ? <Text type="warning">草稿、版本或输入已变化，请重新诊断。</Text> : <Space wrap>
            <Tag color={diagnose.data.decision.allowed ? 'green' : 'red'}>{diagnose.data.decision.allowed ? '允许访问' : '拒绝访问'}</Tag>
            <Text>{diagnose.data.testedIp} · {diagnose.data.decision.matchedEntry ?? (diagnose.data.decision.reason === 'disabled' ? '策略未启用' : diagnose.data.decision.reason === 'whitelist' ? '未命中白名单' : '默认放行')}</Text>
            <Text type="tertiary">基于版本 {diagnose.data.version} 的当前草稿</Text>
          </Space>}
        </div> : null}
      </Collapse.Panel>
      <Collapse.Panel header="误配置恢复" itemKey="recovery">
        <Text type="tertiary">仍可访问时使用版本历史恢复，恢复会再次检查当前来源 IP。无法访问时，由服务器运维人员执行受控恢复命令；恢复记录操作者和原因，不提供公开绕过入口。</Text>
        <div style={{ marginTop: 12 }}><Button disabled={!canUpdate || saveMutation.isPending} onClick={() => Modal.confirm({
          title: '停用 IP 访问控制？', content: '将关闭黑白名单检查，保存后生效。', okText: '填入停用草稿', cancelText: '取消',
          onOk: () => editor.setFields({ whitelistEnabled: false, blacklistEnabled: false }),
        })}>停用访问控制</Button></div>
      </Collapse.Panel>
    </Collapse>
    {canUpdate ? <div><Button theme="solid" disabled={!editor.dirty || !parsed.success || currentDecision?.allowed === false || !context.data || editor.stale || editor.conflict} loading={saveMutation.isPending} onClick={() => void saveSettings()}>保存访问控制设置</Button></div> : null}
  </div>;
}

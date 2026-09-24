import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Checkbox, Collapsible, Input, Select, SideSheet, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { CMS_PREVIEW_MODE_LABELS, CMS_PREVIEW_MODES, type CmsWorkbenchPreview as PreviewResult } from '@zenith/shared/cms';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useCmsWorkbenchPreview } from '@/hooks/queries/cms-workbench';
import { usePermission } from '@/hooks/usePermission';
import CmsContentReferenceInput from './CmsContentReferenceInput';
import CmsConfigurationPicker from './CmsConfigurationPicker';

export interface CmsWorkbenchSelection { contentIds?: number[]; pageIds?: number[]; widgetIds?: number[]; includeSiteConfiguration?: boolean }
type Mode = (typeof CMS_PREVIEW_MODES)[number];
export default function CmsWorkbenchPreview({ visible, onClose, siteId, initialPath = '/', selection, releaseId, initialMode = 'working' }: Readonly<{
  visible: boolean; onClose: () => void; siteId?: number; initialPath?: string; selection?: CmsWorkbenchSelection; releaseId?: number; initialMode?: Mode;
}>) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [path, setPath] = useState(initialPath);
  const [mobile, setMobile] = useState(false);
  const [result, setResult] = useState<PreviewResult>();
  const [error, setError] = useState('');
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [composition, setComposition] = useState<CmsWorkbenchSelection>(selection ?? {});
  const appliedSelection = useRef<CmsWorkbenchSelection>(selection ?? {});
  const { hasPermission } = usePermission();
  const frame = useRef<HTMLIFrameElement>(null);
  const serial = useRef(0);
  const request = useCmsWorkbenchPreview();
  const selectionKey = JSON.stringify(selection ?? {});
  const workingAvailable = Boolean(composition.includeSiteConfiguration || composition.contentIds?.length || composition.pageIds?.length || composition.widgetIds?.length);
  const load = useEventCallback(async (nextMode: Mode, nextPath: string, sameContext = false) => {
    if (!siteId) return;
    const current = ++serial.current;
    setError('');
    try {
      const response = await request.mutateAsync({ body: { siteId, mode: nextMode, path: nextPath, releaseId,
        contentIds: appliedSelection.current.contentIds ?? [], pageIds: appliedSelection.current.pageIds ?? [], widgetIds: appliedSelection.current.widgetIds ?? [], includeSiteConfiguration: appliedSelection.current.includeSiteConfiguration ?? false,
        expectedFingerprint: sameContext ? result?.fingerprint : undefined,
      } });
      if (serial.current === current) { setResult(response); setPath(response.path); }
    } catch (failure) { if (serial.current === current) setError(failure instanceof Error ? failure.message : '预览加载失败'); }
  });
  useEffect(() => {
    serial.current++;
    if (!visible) return;
    const nextSelection = JSON.parse(selectionKey) as CmsWorkbenchSelection;
    appliedSelection.current = nextSelection; setComposition(nextSelection); setSelectionOpen(false);
    setMode(initialMode); setPath(initialPath); setResult(undefined);
    void load(initialMode, initialPath);
  }, [visible, siteId, releaseId, initialMode, initialPath, selectionKey, load]);
  const nonce = useMemo(() => crypto.randomUUID(), [result]);
  const document = useMemo(() => {
    if (!result) return '';
    const policy = `default-src 'none'; img-src http: https: data: blob:; media-src http: https: blob:; font-src http: https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; form-action 'none'; base-uri 'none'`;
    const script = `<script nonce="${nonce}">document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-cms-preview-path]');if(a){e.preventDefault();parent.postMessage({type:'cms-preview-navigation',nonce:${JSON.stringify(nonce)},path:a.getAttribute('data-cms-preview-path')},'*')}});document.addEventListener('submit',function(e){e.preventDefault()});</script>`;
    return result.html.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`).replace('</body>', `${script}</body>`);
  }, [nonce, result]);
  const navigate = useEventCallback((event: MessageEvent) => {
    if (!visible || event.source !== frame.current?.contentWindow || event.data?.type !== 'cms-preview-navigation' || event.data?.nonce !== nonce || typeof event.data.path !== 'string') return;
    void load(mode, event.data.path, true);
  });
  useEffect(() => { window.addEventListener('message', navigate); return () => window.removeEventListener('message', navigate); }, [navigate]);
  return <SideSheet title="页面预览" visible={visible} onCancel={onClose} width="94vw">
    <Space wrap style={{ marginBottom: 12 }}>
      <Select aria-label="预览来源" value={mode} style={{ width: 170 }} optionList={CMS_PREVIEW_MODES.map((value) => ({ value, label: CMS_PREVIEW_MODE_LABELS[value], disabled: value === 'candidate' ? !releaseId : value === 'working' ? !workingAvailable : false }))}
        onChange={(value) => { const next = value as Mode; if (next === 'working') appliedSelection.current = composition; setMode(next); void load(next, path); }} />
      <Input aria-label="预览页面路径" value={path} onChange={setPath} placeholder="例如 /news/" style={{ width: 280 }} onEnterPress={() => void load(mode, path, true)} />
      <Button onClick={() => void load(mode, path, true)} loading={request.isPending}>打开页面</Button>
      <Button onClick={() => void load(mode, path)}>刷新此来源</Button>
      <Button onClick={() => setMobile(false)} theme={mobile ? 'light' : 'solid'}>桌面</Button><Button onClick={() => setMobile(true)} theme={mobile ? 'solid' : 'light'}>手机</Button>
      <Button onClick={() => setSelectionOpen((open) => !open)}>组合工作稿</Button>
    </Space>
    <Collapsible isOpen={selectionOpen}>
      <Space vertical align="start" style={{ width: '100%', marginBottom: 12 }}>
        <Typography.Text type="secondary">选择同一期专题需要查看的已保存内容、页面和部件。应用后，页面内跳转继续使用这组工作稿。</Typography.Text>
        {hasPermission('cms:content:list') ? <><Typography.Text>内容工作稿</Typography.Text><CmsContentReferenceInput siteId={siteId} multiple value={composition.contentIds ?? []} onChange={(value) => setComposition((current) => ({ ...current, contentIds: Array.isArray(value) ? value : [] }))} /></> : null}
        {hasPermission('cms:page:list') ? <><Typography.Text>页面工作稿</Typography.Text><CmsConfigurationPicker kind="page" siteId={siteId} value={composition.pageIds ?? []} onChange={(pageIds) => setComposition((current) => ({ ...current, pageIds }))} /></> : null}
        {hasPermission('cms:widget:list') ? <><Typography.Text>部件工作稿</Typography.Text><CmsConfigurationPicker kind="widget" siteId={siteId} value={composition.widgetIds ?? []} onChange={(widgetIds) => setComposition((current) => ({ ...current, widgetIds }))} /></> : null}
        {hasPermission('cms:publish:view') ? <Checkbox checked={composition.includeSiteConfiguration ?? false} onChange={(event) => setComposition((current) => ({ ...current, includeSiteConfiguration: !!event.target.checked }))}>同时查看已保存的导航、首页编排和站点配置</Checkbox> : null}
        <Button disabled={!workingAvailable} loading={request.isPending} onClick={() => { appliedSelection.current = composition; setMode('working'); void load('working', path); setSelectionOpen(false); }}>应用并预览组合</Button>
      </Space>
    </Collapsible>
    <Banner type="info" description="访客视角预览。互动提交、外部跳转及访问统计均已关闭；页面内跳转保持当前预览来源。" style={{ marginBottom: 12 }} />
    {result ? <Space wrap style={{ marginBottom: 12 }}><Tag color={result.mode === 'online' ? 'green' : 'orange'}>{result.sourceLabel}</Tag>
      {result.generationId ? <Typography.Text type="tertiary">公开代次 #{result.generationId}</Typography.Text> : null}
      {result.contentVersions.map((content) => <Tag key={content.id}>稿件 #{content.id} · v{content.version}</Tag>)}
      {result.status !== 200 ? <Tag color="red">页面状态 {result.status}</Tag> : null}
    </Space> : null}
    {error ? <Banner type="danger" description={error} style={{ marginBottom: 12 }} /> : null}
    <Spin spinning={request.isPending}>{result ? <iframe ref={frame} title="CMS 工作区预览" sandbox="allow-scripts" srcDoc={document} style={{ display: 'block', width: mobile ? 390 : '100%', maxWidth: '100%', height: '72vh', border: '1px solid var(--semi-color-border)', margin: '0 auto' }} /> : null}</Spin>
  </SideSheet>;
}

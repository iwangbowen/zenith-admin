/** 写投稿 / 修改被驳回投稿：站点+栏目选择 + 标题/摘要/正文 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Select, TextArea, Toast, Banner } from '@douyinfe/semi-ui';
import { Send } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { useContribChannels, useMyContribution, useSaveContribution } from '../../hooks/queries';

export default function ContributionEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') ? Number(searchParams.get('id')) : undefined;

  const { data: sites } = useContribChannels();
  const detailQuery = useMyContribution(id);
  const saveMutation = useSaveContribution();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (detailQuery.data) {
      setSiteId(detailQuery.data.siteId);
      setChannelId(detailQuery.data.channelId);
      setTitle(detailQuery.data.title);
      setSummary(detailQuery.data.summary ?? '');
      setBody(detailQuery.data.body ?? '');
    }
  }, [detailQuery.data]);

  useEffect(() => {
    if (!id && !siteId && sites && sites.length > 0) setSiteId(sites[0].id);
  }, [id, siteId, sites]);

  const channels = useMemo(() => sites?.find((s) => s.id === siteId)?.channels ?? [], [sites, siteId]);

  async function handleSubmit() {
    if (!siteId || !channelId) { Toast.warning('请选择投稿栏目'); return; }
    if (!title.trim()) { Toast.warning('请输入标题'); return; }
    if (!body.trim()) { Toast.warning('请输入正文'); return; }
    await saveMutation.mutateAsync({
      id,
      values: id
        ? { channelId, title: title.trim(), summary: summary.trim() || undefined, body }
        : { siteId, channelId, title: title.trim(), summary: summary.trim() || undefined, body },
    });
    Toast.success('投稿已提交，等待审核');
    navigate('/contributions', { replace: true });
  }

  const rejected = detailQuery.data?.status === 'rejected';

  return (
    <MemberPage title={id ? '修改投稿' : '写投稿'} showBack>
      {rejected && detailQuery.data?.rejectReason ? (
        <Banner type="danger" description={`上次驳回原因：${detailQuery.data.rejectReason}`} style={{ marginBottom: 14 }} closeIcon={null} />
      ) : null}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid var(--m-border)',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Select
            placeholder="选择站点"
            value={siteId}
            disabled={!!id}
            onChange={(v) => { setSiteId(v as number); setChannelId(undefined); }}
            optionList={(sites ?? []).map((s) => ({ value: s.id, label: s.name }))}
            style={{ minWidth: 180, flex: 1 }}
          />
          <Select
            placeholder="选择栏目"
            value={channelId}
            onChange={(v) => setChannelId(v as number)}
            optionList={channels.map((ch) => ({ value: ch.id, label: ch.name }))}
            style={{ minWidth: 180, flex: 1 }}
          />
        </div>
        <Input placeholder="标题（必填）" value={title} onChange={setTitle} maxLength={255} showClear />
        <TextArea placeholder="摘要（选填，列表页展示）" value={summary} onChange={setSummary} rows={2} maxCount={500} />
        <TextArea placeholder="正文（必填，支持纯文本/HTML）" value={body} onChange={setBody} rows={12} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button onClick={() => navigate(-1)}>取消</Button>
          <Button theme="solid" icon={<Send size={14} />} loading={saveMutation.isPending} onClick={() => void handleSubmit()}>
            提交审核
          </Button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--m-text-secondary)', marginTop: 10, lineHeight: 1.6 }}>
        投稿提交后将进入平台审核，通过后自动发布到所选栏目；请勿提交违法违规内容。
      </div>
    </MemberPage>
  );
}

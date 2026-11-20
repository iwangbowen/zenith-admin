import type { ReactNode } from 'react';
import { Button, SideSheet, Tag, Typography } from '@douyinfe/semi-ui';
import { Globe, Lock, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { FILE_BUCKET_ACL_LABELS, type FileBucketAccessInfo } from '@zenith/shared/platform';
import './BucketAccessPanel.css';

const { Text } = Typography;

export interface BucketAccessSupport {
  probe: boolean;
  setAcl: boolean;
  setBlockPublicAccess: boolean;
}

interface BucketAccessBaseProps {
  info: FileBucketAccessInfo | null;
  canManage: boolean;
  probeLoading: boolean;
  updateLoading: boolean;
  error?: string | null;
  support: BucketAccessSupport | undefined;
}

export interface BucketAccessSummaryProps extends BucketAccessBaseProps {
  onProbe: () => void;
  onManage: () => void;
}

export interface BucketAccessPanelProps extends BucketAccessBaseProps {
  visible: boolean;
  onClose: () => void;
  onProbe: () => void;
  onMakePrivate: () => void;
  onMakePublicRead: () => void;
  onToggleBlockPublicAccess: (next: boolean) => void;
}

type Tone = 'private' | 'public' | 'unknown';

function isKnown(info: FileBucketAccessInfo | null, error?: string | null): boolean {
  return Boolean(info?.checkedAt) && !error;
}

function toneOf(info: FileBucketAccessInfo | null, error?: string | null): Tone {
  if (!isKnown(info, error)) return 'unknown';
  return info!.effectivePublic ? 'public' : 'private';
}

function VerdictIcon({ tone }: Readonly<{ tone: Tone }>) {
  if (tone === 'public') return <ShieldAlert size={22} />;
  if (tone === 'private') return <ShieldCheck size={22} />;
  return <ShieldQuestion size={22} />;
}

function verdictText(info: FileBucketAccessInfo | null, error?: string | null): string {
  if (error) return '探测失败';
  if (!isKnown(info)) return '尚未探测';
  return info!.effectivePublic ? '匿名可读：是' : '匿名可读：否';
}

function verdictHint(info: FileBucketAccessInfo | null, error?: string | null): string {
  if (error) return '最近一次探测失败，请修复凭据或网络后重新探测。';
  if (!isKnown(info)) return '探测是只读操作，不会修改云端权限。';
  return info!.effectivePublic
    ? 'Bucket 当前允许匿名读取，请确认其中的数据都可以公开。'
    : 'Bucket 当前不允许匿名读取，业务文件仍按各自可见性访问。';
}

function aclLabel(info: FileBucketAccessInfo | null): string {
  return info?.bucketAcl ? FILE_BUCKET_ACL_LABELS[info.bucketAcl] : '未知';
}

function booleanLabel(value: boolean | null | undefined, yes = '是', no = '否'): string {
  if (value === null || value === undefined) return '未知';
  return value ? yes : no;
}

/** 表单顶部的云端权限摘要：只展示结论，详细操作在独立面板中完成 */
export function BucketAccessSummary({
  info,
  canManage,
  probeLoading,
  updateLoading,
  error,
  support,
  onProbe,
  onManage,
}: Readonly<BucketAccessSummaryProps>) {
  const known = isKnown(info, error);
  const tone = toneOf(info, error);
  const busy = probeLoading || updateLoading;

  return (
    <div className="bucket-access-summary" data-tone={tone}>
      <span className="bucket-access-summary__icon"><VerdictIcon tone={tone} /></span>
      <div className="bucket-access-summary__body">
        <div className="bucket-access-summary__title">
          <Text strong>云端 Bucket 权限</Text>
          <Tag size="small" color={tone === 'public' ? 'red' : tone === 'private' ? 'green' : 'grey'}>
            {verdictText(info, error)}
          </Tag>
        </div>
        <Text type="secondary" size="small" className="bucket-access-summary__meta">
          {error
            ? '云端状态未确认；请修复后重新探测'
            : known
              ? `Bucket ACL ${aclLabel(info)} · ${info?.blockPublicAccess === null || info?.blockPublicAccess === undefined
                ? '阻止公共访问未知'
                : info.blockPublicAccess ? '阻止公共访问开启' : '阻止公共访问关闭'}${info?.checkedAt ? ` · 检测于 ${info.checkedAt}` : ''}`
              : '尚未探测；探测只读，不会修改云端权限'}
        </Text>
        {error && <Text type="danger" size="small" className="bucket-access-summary__error">最近一次探测失败，可在权限面板中查看原因</Text>}
        {!canManage && <Text type="tertiary" size="small" className="bucket-access-summary__error">当前账号只能查看，不能修改云端权限</Text>}
      </div>
      <div className="bucket-access-summary__actions">
        {support?.probe && (
          <Button size="small" icon={<RefreshCw size={14} />} loading={probeLoading} disabled={busy} onClick={onProbe}>
            {known ? '重新探测' : '立即探测'}
          </Button>
        )}
        <Button size="small" type="primary" theme="solid" onClick={onManage}>
          管理权限
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="bucket-access-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ActionRow({
  title,
  description,
  action,
}: Readonly<{ title: string; description: string; action: ReactNode }>) {
  return (
    <div className="bucket-access-action">
      <div className="bucket-access-action__text">
        <Text strong>{title}</Text>
        <Text type="secondary" size="small">{description}</Text>
      </div>
      {action}
    </div>
  );
}

/** 独立的云端权限面板：探测与修改都在这里完成，不参与配置表单的「保存」 */
export function BucketAccessPanel({
  visible,
  onClose,
  info,
  canManage,
  probeLoading,
  updateLoading,
  error,
  support,
  onProbe,
  onMakePrivate,
  onMakePublicRead,
  onToggleBlockPublicAccess,
}: Readonly<BucketAccessPanelProps>) {
  const known = isKnown(info, error);
  const tone = toneOf(info, error);
  const busy = probeLoading || updateLoading;
  const reason = !canManage
    ? '需要 system:file:config:bucket-access 权限'
    : !known
      ? '请先成功探测当前权限'
      : null;

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      title="云端 Bucket 权限"
      width={560}
      closeOnEsc
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="bucket-access-panel">
        <div className="bucket-access-warning">
          <TriangleAlert size={18} />
          <div>
            <Text strong>以下操作会立即修改云端 Bucket</Text>
            <Text type="secondary" size="small">
              不受配置「保存」影响；新增配置使用当前表单凭据，权限变更会影响同一 Bucket 的其他应用。
            </Text>
          </div>
        </div>

        <section className="bucket-access-section">
          <div className="bucket-access-verdict" data-tone={tone}>
            <span className="bucket-access-verdict__icon"><VerdictIcon tone={tone} /></span>
            <div className="bucket-access-verdict__body">
              <Text strong className="bucket-access-verdict__title">{verdictText(info, error)}</Text>
              <Text type="secondary" size="small">{verdictHint(info, error)}</Text>
            </div>
          </div>

          <dl className="bucket-access-facts">
            <Fact label="Bucket ACL">{aclLabel(info)}</Fact>
            <Fact label="Bucket 级阻止公共访问">{booleanLabel(info?.blockPublicAccess, '开启', '关闭')}</Fact>
            {(info?.accountBlockPublicAccess !== null && info?.accountBlockPublicAccess !== undefined) && (
              <Fact label="账号级阻止公共访问">{booleanLabel(info.accountBlockPublicAccess, '开启', '关闭')}</Fact>
            )}
            <Fact label="Bucket Policy 公共访问">{booleanLabel(info?.policyPublic, '是', '否')}</Fact>
            {(info?.publicStatus !== null && info?.publicStatus !== undefined) && (
              <Fact label="云端公共状态">{info.publicStatus ? '公共' : '私有'}</Fact>
            )}
            <Fact label="检测时间">{info?.checkedAt || '尚未探测'}</Fact>
          </dl>

          {error && (
            <div className="bucket-access-error">
              <Text type="danger" strong>最近一次探测失败</Text>
              <Text type="danger" size="small">{error}</Text>
            </div>
          )}

          {support?.probe && (
            <Button icon={<RefreshCw size={14} />} loading={probeLoading} disabled={busy} onClick={onProbe}>
              {known ? '重新探测' : '探测权限'}
            </Button>
          )}
        </section>

        <section className="bucket-access-section">
          <div className="bucket-access-section__head">
            <Text strong>修改云端权限</Text>
            <Tag size="small" color="red">立即生效</Tag>
          </div>
          <Text type="secondary" size="small" className="bucket-access-section__desc">
            这些操作直接影响 Bucket，不会随配置「取消」回滚。
          </Text>
          {reason && <Text type="tertiary" size="small" className="bucket-access-disabled-reason">{reason}</Text>}

          {support?.setAcl ? (
            <>
              <ActionRow
                title="将 Bucket ACL 设为私有"
                description="关闭 Bucket 的匿名读；依赖公共读的其他应用会立即受影响。"
                action={(
                  <Button
                    size="small"
                    disabled={Boolean(reason) || busy || info?.bucketAcl === 'private'}
                    loading={updateLoading}
                    onClick={onMakePrivate}
                  >
                    设为私有
                  </Button>
                )}
              />
              <ActionRow
                title="将 Bucket ACL 设为公共读"
                description="允许匿名读取 Bucket 内的公共读对象，可能暴露敏感数据。"
                action={(
                  <Button
                    size="small"
                    type="danger"
                    disabled={Boolean(reason) || busy || info?.bucketAcl === 'public-read'}
                    loading={updateLoading}
                    onClick={onMakePublicRead}
                  >
                    设为公共读
                  </Button>
                )}
              />
            </>
          ) : (
            <Text type="secondary" size="small">当前存储类型不支持通过本页修改 Bucket ACL。</Text>
          )}

          {support?.setBlockPublicAccess && (
            <ActionRow
              title={info?.blockPublicAccess ? '关闭 Bucket 级阻止公共访问' : '开启 Bucket 级阻止公共访问'}
              description={info?.blockPublicAccess
                ? '关闭后，已存在的公共读对象或 Policy 可能立即暴露。'
                : '开启后，云端会拦截所有公共读 ACL 与 Policy。'}
              action={(
                <Button
                  size="small"
                  type={info?.blockPublicAccess ? 'danger' : 'primary'}
                  disabled={Boolean(reason) || busy}
                  loading={updateLoading}
                  onClick={() => onToggleBlockPublicAccess(!(info?.blockPublicAccess ?? false))}
                >
                  {info?.blockPublicAccess ? '关闭阻止' : '开启阻止'}
                </Button>
              )}
            />
          )}

          {!canManage && (
            <div className="bucket-access-lock">
              <Lock size={14} />
              <Text type="tertiary" size="small">当前账号没有修改云端权限的权限，以上操作不可用。</Text>
            </div>
          )}
          {canManage && (
            <div className="bucket-access-lock">
              <Globe size={14} />
              <Text type="tertiary" size="small">修改成功后会自动刷新状态；同 Bucket 的其他应用可能同时受影响。</Text>
            </div>
          )}
        </section>
      </div>
    </SideSheet>
  );
}

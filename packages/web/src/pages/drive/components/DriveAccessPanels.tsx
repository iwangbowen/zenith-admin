import { useRef, useState } from 'react';
import { AvatarGroup, Badge, Button, Empty, Form, Select, Spin, Tabs, TabPane, Tag, TextArea, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Eye, Inbox, ShieldQuestion } from 'lucide-react';
import {
  DRIVE_ACCESS_REQUEST_STATUS_LABELS,
  DRIVE_NODE_TYPE_LABELS,
  DRIVE_REQUESTABLE_ROLES,
  DRIVE_ROLE_LABELS,
  type DriveAccessRequest,
  type DriveAccessRequestStatus,
  type DriveRole,
} from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import { UserAvatar } from '@/components/UserAvatar';
import { ApiError } from '@/lib/query';
import {
  useCancelDriveAccessRequest, useCreateDriveAccessRequest, useDecideDriveAccessRequest, useDriveAccessRequests, useDriveAccessTarget, useDriveNodePresence,
} from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTimeForApi } from '@/utils/date';

const STATUS_COLORS: Record<DriveAccessRequestStatus, 'orange' | 'green' | 'red' | 'grey'> = { pending: 'orange', approved: 'green', rejected: 'red', cancelled: 'grey' };
const ROLE_OPTIONS = DRIVE_REQUESTABLE_ROLES.map((r) => ({ value: r, label: DRIVE_ROLE_LABELS[r] }));

// ─── 谁在看 ─────────────────────────────────────────────────────────────────

/** 正在查看该节点的用户（含自己）：抽屉打开期间持续心跳 */
export function DrivePresenceBadge({ nodeId }: { readonly nodeId: number }) {
  const query = useDriveNodePresence(nodeId);
  const users = query.data ?? [];
  if (users.length <= 1) return null;
  return (
    <Tooltip content={`${users.length} 人正在查看：${users.map((u) => u.name).join('、')}`}>
      <span className="drive-presence" aria-label={`${users.length} 人正在查看`}>
        <Eye size={14} aria-hidden />
        <AvatarGroup size="extra-small" maxCount={4}>
          {users.map((u) => <UserAvatar key={u.userId} name={u.name} avatar={u.avatar} semiSize="extra-small" size={null} />)}
        </AvatarGroup>
        <span>{users.length} 人在看</span>
      </span>
    </Tooltip>
  );
}

// ─── 无权访问 → 申请 ────────────────────────────────────────────────────────

interface AccessGateProps {
  readonly nodeId: number;
  readonly error: unknown;
  readonly onRetry: () => void;
}

/** 节点详情 403 时的申请入口；404 / 其他错误保持原提示 */
export function DriveAccessGate({ nodeId, error, onRetry }: AccessGateProps) {
  const forbidden = error instanceof ApiError && error.code === 403;
  const target = useDriveAccessTarget(nodeId, forbidden);
  const create = useCreateDriveAccessRequest();
  const cancel = useCancelDriveAccessRequest();
  const [role, setRole] = useState<(typeof DRIVE_REQUESTABLE_ROLES)[number]>('viewer');
  const [reason, setReason] = useState('');

  if (!forbidden) {
    return (
      <Empty title="无法打开文件" description="文件可能已删除，或你没有访问权限">
        <Button onClick={onRetry}>重试</Button>
      </Empty>
    );
  }
  if (target.isPending) return <div className="drive-access-gate"><Spin /></div>;
  const info = target.data;
  if (!info) {
    return <Empty title="无法打开文件" description="文件可能已删除"><Button onClick={onRetry}>重试</Button></Empty>;
  }
  const submit = async () => {
    await create.mutateAsync({ body: { nodeId, role, reason: reason.trim() || undefined } });
    Toast.success('申请已提交，管理者审批后会通知你');
    setReason('');
  };
  return (
    <div className="drive-access-gate">
      <ShieldQuestion size={40} color="var(--semi-color-text-2)" aria-hidden />
      <Typography.Title heading={5} style={{ margin: 0 }}>你没有访问「{info.nodeName}」的权限</Typography.Title>
      <Typography.Text type="tertiary">{DRIVE_NODE_TYPE_LABELS[info.nodeType]} · 所在空间「{info.spaceName}」。可以向管理者申请访问，审批通过后会通知你。</Typography.Text>
      {info.pendingRequestId ? (
        <>
          <Tag color="orange">申请审批中</Tag>
          <Button type="tertiary" loading={cancel.isPending} onClick={() => void cancel.mutateAsync({ params: { id: info.pendingRequestId! } }).then(() => Toast.success('已撤回'))}>撤回申请</Button>
        </>
      ) : (
        <div className="drive-access-gate__form">
          <Select value={role} onChange={(v) => setRole(v as typeof role)} optionList={ROLE_OPTIONS} style={{ width: '100%' }} aria-label="申请的权限" />
          <TextArea value={reason} onChange={setReason} maxLength={500} rows={3} placeholder="申请理由（可选），有助于管理者快速判断" aria-label="申请理由" />
          <Button theme="solid" loading={create.isPending} onClick={() => void submit()}>提交申请</Button>
          <Button type="tertiary" onClick={onRetry}>重新加载</Button>
        </div>
      )}
    </div>
  );
}

// ─── 申请列表（待我审批 / 我提交的）────────────────────────────────────────

interface DecideFormValues {
  role: DriveRole;
  expireAt?: Date | null;
  note?: string;
}

function RequestItem({ request, box, onOpenNode }: { readonly request: DriveAccessRequest; readonly box: 'inbox' | 'outbox'; readonly onOpenNode: (req: DriveAccessRequest) => void }) {
  const { hasPermission } = usePermission();
  const decide = useDecideDriveAccessRequest();
  const cancel = useCancelDriveAccessRequest();
  const [approving, setApproving] = useState(false);
  const formApiRef = useRef<FormApi<DecideFormValues> | null>(null);
  const canDecide = box === 'inbox' && request.status === 'pending' && hasPermission('drive:node:grant');

  const approve = async () => {
    const api = formApiRef.current;
    if (!api) return;
    const values = await api.validate();
    await decide.mutateAsync({ params: { id: request.id }, body: { approve: true, role: values.role as (typeof DRIVE_REQUESTABLE_ROLES)[number], expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null, note: values.note || undefined } });
    setApproving(false);
    Toast.success('已通过并授权');
  };
  const reject = async () => {
    await decide.mutateAsync({ params: { id: request.id }, body: { approve: false } });
    Toast.success('已拒绝');
  };

  return (
    <li className="drive-access-request">
      <div className="drive-access-request__head">
        <Typography.Text strong>
          {box === 'inbox' ? `${request.requesterName ?? '用户'} 申请` : '我申请'}「{request.nodeName}」的{DRIVE_ROLE_LABELS[request.role]}权限
        </Typography.Text>
        <Tag color={STATUS_COLORS[request.status]} size="small">{DRIVE_ACCESS_REQUEST_STATUS_LABELS[request.status]}</Tag>
      </div>
      <Typography.Text className="drive-access-request__meta">
        {DRIVE_NODE_TYPE_LABELS[request.nodeType]} · 空间「{request.spaceName}」 · {request.createdAt}
        {request.reason ? ` · 理由：${request.reason}` : ''}
        {request.status === 'approved' && request.grantedRole ? ` · 授予${DRIVE_ROLE_LABELS[request.grantedRole]}${request.grantedExpireAt ? `（至 ${request.grantedExpireAt}）` : ''}` : ''}
        {request.decidedByName ? ` · ${request.decidedByName} 处理` : ''}
        {request.decisionNote ? `：${request.decisionNote}` : ''}
      </Typography.Text>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {box === 'inbox' && <Button size="small" theme="borderless" onClick={() => onOpenNode(request)}>查看{DRIVE_NODE_TYPE_LABELS[request.nodeType]}</Button>}
        {canDecide && <Button size="small" theme="solid" onClick={() => setApproving(true)}>通过</Button>}
        {canDecide && <Button size="small" type="danger" loading={decide.isPending} onClick={() => void reject()}>拒绝</Button>}
        {box === 'outbox' && request.status === 'pending' && <Button size="small" type="tertiary" loading={cancel.isPending} onClick={() => void cancel.mutateAsync({ params: { id: request.id } }).then(() => Toast.success('已撤回'))}>撤回</Button>}
        {box === 'outbox' && request.status === 'approved' && <Button size="small" theme="borderless" onClick={() => onOpenNode(request)}>打开</Button>}
      </div>
      <AppModal visible={approving} title={`通过申请 · ${request.nodeName}`} onCancel={() => setApproving(false)} onOk={() => void approve()} okButtonProps={{ loading: decide.isPending }} width={480} closeOnEsc>
        <Form<DecideFormValues> getFormApi={(api) => { formApiRef.current = api; }} initValues={{ role: request.role, expireAt: null, note: '' }} labelPosition="left" labelWidth={90}>
          <Form.Select field="role" label="授予角色" optionList={ROLE_OPTIONS} style={{ width: '100%' }} />
          <Form.DatePicker field="expireAt" label="到期时间" type="dateTime" style={{ width: '100%' }} placeholder="留空为长期授权" />
          <Form.Input field="note" label="备注" placeholder="可选，随通知发送给申请人" maxLength={200} />
        </Form>
      </AppModal>
    </li>
  );
}

interface AccessRequestsModalProps {
  readonly visible: boolean;
  readonly initialBox?: 'inbox' | 'outbox';
  readonly onClose: () => void;
  readonly onOpenNode: (req: DriveAccessRequest) => void;
}

export function DriveAccessRequestsModal({ visible, initialBox = 'inbox', onClose, onOpenNode }: AccessRequestsModalProps) {
  const [box, setBox] = useState<'inbox' | 'outbox'>(initialBox);
  const [status, setStatus] = useState<DriveAccessRequestStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const query = useDriveAccessRequests({ box, status, page, pageSize: 20 }, visible);
  const list = query.data?.list ?? [];
  const total = query.data?.total ?? 0;
  return (
    <AppModal visible={visible} title="访问申请" onCancel={onClose} footer={null} width={720} closeOnEsc>
      <Tabs type="line" size="small" activeKey={box} onChange={(k) => { setBox(k as 'inbox' | 'outbox'); setPage(1); }}
        tabBarExtraContent={(
          <Select value={status ?? ''} onChange={(v) => { setStatus((v as string) ? (v as DriveAccessRequestStatus) : undefined); setPage(1); }} size="small" style={{ width: 120 }} aria-label="状态"
            optionList={[{ value: '', label: '全部状态' }, ...Object.entries(DRIVE_ACCESS_REQUEST_STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
        )}>
        <TabPane tab={<span><Inbox size={14} style={{ verticalAlign: -2, marginRight: 4 }} />待我审批</span>} itemKey="inbox" />
        <TabPane tab="我提交的" itemKey="outbox" />
      </Tabs>
      <Spin spinning={query.isFetching}>
        {list.length === 0
          ? <Empty description={box === 'inbox' ? '没有需要你处理的申请' : '你还没有提交过访问申请'} style={{ padding: '24px 0' }} />
          : <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>{list.map((r) => <RequestItem key={r.id} request={r} box={box} onOpenNode={onOpenNode} />)}</ul>}
        {total > 20 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
            <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <Button size="small" disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </div>
        )}
      </Spin>
    </AppModal>
  );
}

/** 工作台头部入口：待审批数角标 */
export function DriveAccessRequestsButton({ pending, onClick }: { readonly pending: number; readonly onClick: () => void }) {
  return (
    <Tooltip content={pending > 0 ? `${pending} 条访问申请待处理` : '访问申请'}>
      <Badge count={pending > 0 ? pending : undefined} overflowCount={99} type="danger">
        <Button size="small" theme="borderless" icon={<Inbox size={14} />} aria-label="访问申请" onClick={onClick} />
      </Badge>
    </Tooltip>
  );
}

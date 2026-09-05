import { useMemo, useState, type CSSProperties } from 'react';
import { ArrayField, Banner, Button, Descriptions, Form, Modal, SideSheet, TabPane, Tabs, Tag, TextArea, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import type {
  CreatePaymentFundReservationInput,
  CreatePaymentLedgerAccountInput,
  PaymentFundReservation,
  PaymentFundReservationStatus,
  PaymentJournal,
  PaymentJournalLine,
  PaymentLedgerAccount,
  PaymentLedgerAccountCode,
  PaymentLedgerNormalBalance,
  PostPaymentJournalInput,
} from '@zenith/shared/payment';
import {
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_FUND_RESERVATION_STATUSES,
  PAYMENT_LEDGER_ACCOUNT_CODE_LABELS,
  PAYMENT_LEDGER_ACCOUNT_CODES,
} from '@zenith/shared/payment';
import './PaymentLedgerPage.css';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import { usePaymentChannelOperationLookup } from '@/hooks/queries/payment-channels';
import {
  paymentFundReservationKeys,
  paymentJournalKeys,
  paymentLedgerAccountKeys,
  useCreatePaymentFundReservation,
  useCreatePaymentLedgerAccount,
  usePaymentFundReservationList,
  usePaymentJournalDetail,
  usePaymentJournalList,
  usePaymentLedgerAccountList,
  usePostPaymentJournal,
  useReversePaymentJournal,
  useTransitionPaymentFundReservation,
} from '@/hooks/queries/payment-journals';
import { formatDateTimeForApi, formatDateTimeRangeForApi } from '@/utils/date';
import { formatMinorAmount } from '@/utils/payment';
import { confirmDanger } from '@/utils/confirm';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';

const ACCOUNT_STATUS_ITEMS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];
const NORMAL_BALANCE_LABELS: Record<PaymentLedgerNormalBalance, string> = { debit: '借方', credit: '贷方' };
const RESERVATION_STATUS_LABELS: Record<PaymentFundReservationStatus, string> = {
  active: '有效',
  captured: '已核销',
  released: '已释放',
  expired: '已过期',
};
const RESERVATION_STATUS_COLORS = {
  active: 'blue',
  captured: 'green',
  released: 'grey',
  expired: 'orange',
} as const satisfies Record<PaymentFundReservationStatus, string>;
const RESERVATION_STATUS_ITEMS = PAYMENT_FUND_RESERVATION_STATUSES.map((value) => ({
  value,
  label: RESERVATION_STATUS_LABELS[value],
}));
const CURRENCY_OPTIONS = [{ value: 'CNY', label: 'CNY · 人民币' }];

function amountTotal(lines: readonly PaymentJournalLine[], field: 'debitAmount' | 'creditAmount'): bigint {
  return lines.reduce((total, line) => total + BigInt(line[field]), 0n);
}

interface AccountSearchParams {
  keyword: string;
  appId?: number;
  channelConfigId?: number;
  currency?: string;
  status?: string;
}

interface JournalSearchParams {
  sourceType: string;
  appId?: number;
  channelConfigId?: number;
  currency?: string;
  timeRange: [Date, Date] | null;
}

interface ReservationSearchParams {
  accountId?: number;
  status?: string;
  sourceType: string;
  timeRange: [Date, Date] | null;
}

interface AccountFormValues {
  name: string;
  code: PaymentLedgerAccountCode;
  appId: number;
  channelConfigId: number;
  currency: string;
}

interface JournalLineFormValues {
  accountId?: number;
  debitAmount?: string;
  creditAmount?: string;
  memo?: string;
}

interface JournalFormValues {
  sourceType: string;
  sourceId: string;
  description: string;
  appId: number;
  channelConfigId: number;
  currency: string;
  lines: JournalLineFormValues[];
}

interface ReservationFormValues {
  accountId: number;
  sourceType: string;
  sourceId: string;
  amount: string;
  reason: string;
  expiresAt?: Date;
}

interface JournalScope {
  appId?: number;
  channelConfigId?: number;
  currency: string;
}

function JournalLinesField({ accountOptions }: Readonly<{ accountOptions: Array<{ value: number; label: string }> }>) {
  return (
    <ArrayField field="lines">
      {({ add, arrayFields }) => (
        <div className="payment-journal-lines">
          <div className="payment-journal-lines__header" aria-hidden="true">
            <span>账本账户</span>
            <span>借方金额（最小单位）</span>
            <span>贷方金额（最小单位）</span>
            <span>摘要</span>
            <span />
          </div>
          {arrayFields.map(({ field, key, remove }, index) => (
            <div key={`${key}-${index}`} className="payment-journal-lines__row">
              <Form.Select
                field={`${field}[accountId]`}
                noLabel
                filter
                placeholder={`第 ${index + 1} 行账户`}
                optionList={accountOptions}
                rules={[{ required: true, message: '请选择账户' }]}
              />
              <Form.Input
                field={`${field}[debitAmount]`}
                noLabel
                initValue="0"
                placeholder="0"
                rules={[{ pattern: /^(0|[1-9]\d*)$/, message: '请输入非负整数' }]}
              />
              <Form.Input
                field={`${field}[creditAmount]`}
                noLabel
                initValue="0"
                placeholder="0"
                rules={[{ pattern: /^(0|[1-9]\d*)$/, message: '请输入非负整数' }]}
              />
              <Form.Input field={`${field}[memo]`} noLabel maxLength={256} placeholder="分录摘要" />
              <Button
                type="danger"
                theme="borderless"
                icon={<Trash2 size={15} />}
                aria-label="删除分录行"
                disabled={arrayFields.length <= 2}
                onClick={() => remove()}
              />
            </div>
          ))}
          <Button
            theme="light"
            icon={<Plus size={15} />}
            disabled={arrayFields.length >= 100}
            onClick={() => add()}
            className="payment-journal-lines__add"
          >
            添加分录行
          </Button>
        </div>
      )}
    </ArrayField>
  );
}

export default function PaymentLedgerPage() {
  const { hasPermission } = usePermission();
  const canView = hasPermission('payment:ledger:list');
  const canCreateAccount = hasPermission('payment:ledger:account:create');
  const canPostJournal = hasPermission('payment:ledger:post');
  const canReverseJournal = hasPermission('payment:ledger:reverse');
  const canReserve = hasPermission('payment:ledger:reserve');
  const [activeTab, setActiveTab] = useUrlTabState(['accounts', 'journals', 'reservations'] as const, 'accounts');
  const [journalDetailTarget, setJournalDetailTarget] = useState<PaymentJournal | null>(null);
  const [reverseTarget, setReverseTarget] = useState<PaymentJournal | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reservationTransitionTarget, setReservationTransitionTarget] = useState<PaymentFundReservation | null>(null);
  const [reservationTransitionAction, setReservationTransitionAction] = useState<'capture' | 'release' | null>(null);
  const [reservationTransitionReason, setReservationTransitionReason] = useState('');
  const [journalScope, setJournalScope] = useState<JournalScope>({ currency: 'CNY' });

  const appLookupQuery = usePaymentAppList({ page: 1, pageSize: 100, status: 'enabled' }, canView);
  const merchantLookupQuery = usePaymentChannelOperationLookup(canView);
  const apps = useMemo(() => appLookupQuery.data?.list ?? [], [appLookupQuery.data?.list]);
  const merchants = useMemo(() => merchantLookupQuery.data ?? [], [merchantLookupQuery.data]);
  const appOptions = useMemo(() => apps.map((app) => ({ value: app.id, label: app.name })), [apps]);
  const merchantOptions = useMemo(
    () => merchants.map((merchant) => ({ value: merchant.id, label: `${merchant.name} · ${PAYMENT_CHANNEL_LABELS[merchant.channel]} · ${merchant.sandbox ? '沙箱' : '生产'}` })),
    [merchants],
  );
  const appNameById = useMemo(() => new Map(apps.map((app) => [app.id, app.name])), [apps]);
  const merchantNameById = useMemo(() => new Map(merchants.map((merchant) => [merchant.id, merchant.name])), [merchants]);

  const accountSearch = useListSearch<AccountSearchParams>({
    defaults: { keyword: '', currency: undefined, status: undefined },
    listKey: paymentLedgerAccountKeys.lists,
  });
  const journalSearch = useListSearch<JournalSearchParams>({
    defaults: { sourceType: '', currency: undefined, timeRange: null },
    listKey: paymentJournalKeys.lists,
  });
  const reservationSearch = useListSearch<ReservationSearchParams>({
    defaults: { status: undefined, sourceType: '', timeRange: null },
    listKey: paymentFundReservationKeys.lists,
  });

  const accountQuery = usePaymentLedgerAccountList({
    page: accountSearch.page,
    pageSize: accountSearch.pageSize,
    keyword: accountSearch.submittedParams.keyword.trim() || undefined,
    appId: accountSearch.submittedParams.appId,
    channelConfigId: accountSearch.submittedParams.channelConfigId,
    currency: accountSearch.submittedParams.currency || undefined,
    status: (accountSearch.submittedParams.status as 'enabled' | 'disabled') || undefined,
  }, canView && activeTab === 'accounts');
  const journalQuery = usePaymentJournalList({
    page: journalSearch.page,
    pageSize: journalSearch.pageSize,
    sourceType: journalSearch.submittedParams.sourceType.trim() || undefined,
    appId: journalSearch.submittedParams.appId,
    channelConfigId: journalSearch.submittedParams.channelConfigId,
    currency: journalSearch.submittedParams.currency || undefined,
    ...formatDateTimeRangeForApi(journalSearch.submittedParams.timeRange),
  }, canView && activeTab === 'journals');
  const reservationQuery = usePaymentFundReservationList({
    page: reservationSearch.page,
    pageSize: reservationSearch.pageSize,
    accountId: reservationSearch.submittedParams.accountId,
    status: (reservationSearch.submittedParams.status as PaymentFundReservationStatus) || undefined,
    sourceType: reservationSearch.submittedParams.sourceType.trim() || undefined,
    ...formatDateTimeRangeForApi(reservationSearch.submittedParams.timeRange),
  }, canView && activeTab === 'reservations');

  const accountData = accountQuery.data?.list ?? [];
  const journalData = journalQuery.data?.list ?? [];
  const reservationData = reservationQuery.data?.list ?? [];

  const accountCreateMutation = useCreatePaymentLedgerAccount();
  const accountModal = useEditModal<PaymentLedgerAccount, AccountFormValues, CreatePaymentLedgerAccountInput>({
    entityName: '账本账户',
    save: {
      mutateAsync: ({ values }) => accountCreateMutation.mutateAsync({ body: values }),
      isPending: accountCreateMutation.isPending,
    },
    defaults: { currency: 'CNY' },
    beforeSave: (values) => ({ ...values, name: values.name.trim(), currency: values.currency.trim().toUpperCase() }),
    successMessage: () => '账本账户创建成功',
    labelWidth: 110,
  });

  const postJournalMutation = usePostPaymentJournal();
  const journalModal = useEditModal<PaymentJournal, JournalFormValues, PostPaymentJournalInput>({
    entityName: '资金凭证',
    save: {
      mutateAsync: ({ values }) => postJournalMutation.mutateAsync({ body: values }),
      isPending: postJournalMutation.isPending,
    },
    defaults: {
      currency: 'CNY',
      sourceType: 'manual.adjustment',
      lines: [
        { debitAmount: '0', creditAmount: '0' },
        { debitAmount: '0', creditAmount: '0' },
      ],
    },
    beforeSave: (values) => {
      const lines = (values.lines ?? []).map((line) => ({
        accountId: Number(line.accountId),
        debitAmount: String(line.debitAmount ?? '0').trim(),
        creditAmount: String(line.creditAmount ?? '0').trim(),
        memo: line.memo?.trim() || undefined,
      }));
      if (lines.length < 2) {
        Toast.warning('资金凭证至少需要两条分录');
        abortSubmit('validation');
      }
      let debitTotal = 0n;
      let creditTotal = 0n;
      try {
        for (const line of lines) {
          const debit = BigInt(line.debitAmount);
          const credit = BigInt(line.creditAmount);
          if ((debit > 0n) === (credit > 0n)) {
            Toast.warning('每条分录必须且只能填写借方或贷方金额');
            abortSubmit('validation');
          }
          debitTotal += debit;
          creditTotal += credit;
        }
      } catch {
        Toast.warning('借贷金额必须是非负整数十进制字符串');
        abortSubmit('validation');
      }
      if (debitTotal <= 0n || debitTotal !== creditTotal) {
        Toast.warning('借贷合计必须相等且大于 0');
        abortSubmit('validation');
      }
      return {
        sourceType: values.sourceType.trim(),
        sourceId: values.sourceId.trim(),
        description: values.description.trim(),
        appId: values.appId,
        channelConfigId: values.channelConfigId,
        currency: values.currency.trim().toUpperCase(),
        lines,
      };
    },
    successMessage: () => '资金凭证过账成功',
    onSaved: () => setJournalScope({ currency: 'CNY' }),
    labelWidth: 110,
  });

  const reservationCreateMutation = useCreatePaymentFundReservation();
  const reservationModal = useEditModal<PaymentFundReservation, ReservationFormValues, CreatePaymentFundReservationInput>({
    entityName: '资金预占',
    save: {
      mutateAsync: ({ values }) => reservationCreateMutation.mutateAsync({ body: values }),
      isPending: reservationCreateMutation.isPending,
    },
    defaults: { sourceType: 'manual.reservation' },
    beforeSave: (values) => ({
      accountId: values.accountId,
      sourceType: values.sourceType.trim(),
      sourceId: values.sourceId.trim(),
      amount: values.amount.trim(),
      reason: values.reason.trim(),
      expiresAt: values.expiresAt ? formatDateTimeForApi(values.expiresAt) : undefined,
    }),
    successMessage: () => '资金预占创建成功',
    // 「金额（最小单位）」8 个字符 + 必填星号，130 星号仍换行
    labelWidth: 140,
  });

  const accountLookupQuery = usePaymentLedgerAccountList(
    { page: 1, pageSize: 100, status: 'enabled' },
    canView && (activeTab === 'reservations' || reservationModal.visible),
  );
  const enabledAccounts = useMemo(() => accountLookupQuery.data?.list ?? [], [accountLookupQuery.data?.list]);
  const accountNameById = useMemo(() => new Map(enabledAccounts.map((account) => [account.id, account.name])), [enabledAccounts]);
  const accountOptions = useMemo(
    () => enabledAccounts.map((account) => ({
      value: account.id,
      label: `${account.name} · ${PAYMENT_LEDGER_ACCOUNT_CODE_LABELS[account.code]} · ${account.currency}`,
    })),
    [enabledAccounts],
  );

  const scopedAccountQuery = usePaymentLedgerAccountList({
    page: 1,
    pageSize: 100,
    appId: journalScope.appId,
    channelConfigId: journalScope.channelConfigId,
    currency: journalScope.currency,
    status: 'enabled',
  }, journalModal.visible && !!journalScope.appId && !!journalScope.channelConfigId && !!journalScope.currency);
  const scopedAccountOptions = useMemo(
    () => (scopedAccountQuery.data?.list ?? []).map((account) => ({
      value: account.id,
      label: `${account.name} · ${PAYMENT_LEDGER_ACCOUNT_CODE_LABELS[account.code]}`,
    })),
    [scopedAccountQuery.data],
  );

  const detailQuery = usePaymentJournalDetail(journalDetailTarget?.id, !!journalDetailTarget);
  const detailJournal = journalDetailTarget ? (detailQuery.data ?? journalDetailTarget) : null;
  const detailDebit = detailJournal ? amountTotal(detailJournal.lines, 'debitAmount') : 0n;
  const detailCredit = detailJournal ? amountTotal(detailJournal.lines, 'creditAmount') : 0n;

  const reverseMutation = useReversePaymentJournal();
  const captureMutation = useTransitionPaymentFundReservation('capture');
  const releaseMutation = useTransitionPaymentFundReservation('release');

  function openJournalCreate() {
    setJournalScope({ currency: 'CNY' });
    journalModal.openCreate();
  }

  function openReverse(journal: PaymentJournal) {
    setReverseTarget(journal);
    setReverseReason('');
  }

  function closeReverse() {
    setReverseTarget(null);
    setReverseReason('');
  }

  function submitReverse() {
    if (!reverseTarget) return;
    const reason = reverseReason.trim();
    if (!reason) {
      Toast.warning('请填写冲正原因');
      return;
    }
    confirmDanger({
      title: `确认冲正凭证 ${reverseTarget.journalNo}？`,
      content: '系统将生成借贷方向完全相反的新凭证，原凭证保持不可变。',
      onOk: async () => {
        await reverseMutation.mutateAsync({ params: { id: reverseTarget.id }, body: { reason } });
        Toast.success('冲正凭证已过账');
        closeReverse();
      },
    });
  }

  function openReservationTransition(reservation: PaymentFundReservation, action: 'capture' | 'release') {
    setReservationTransitionTarget(reservation);
    setReservationTransitionAction(action);
    setReservationTransitionReason('');
  }

  function closeReservationTransition() {
    setReservationTransitionTarget(null);
    setReservationTransitionAction(null);
    setReservationTransitionReason('');
  }

  function submitReservationTransition() {
    if (!reservationTransitionTarget || !reservationTransitionAction) return;
    const reason = reservationTransitionReason.trim();
    if (!reason) {
      Toast.warning('请填写处理原因');
      return;
    }
    const target = reservationTransitionTarget;
    const action = reservationTransitionAction;
    const execute = async () => {
      const mutation = action === 'capture' ? captureMutation : releaseMutation;
      await mutation.mutateAsync({ params: { id: target.id }, body: { version: target.version, reason } });
      Toast.success(action === 'capture' ? '资金预占已核销' : '资金预占已释放');
      closeReservationTransition();
    };
    const options = {
      title: action === 'capture' ? `确认核销预占 ${target.reservationNo}？` : `确认释放预占 ${target.reservationNo}？`,
      content: `${formatMinorAmount(target.amount, target.currency)}，提交时将校验版本 v${target.version}。`,
      onOk: execute,
    };
    if (action === 'release') confirmDanger(options);
    else Modal.confirm(options);
  }

  const accountColumns: ColumnProps<PaymentLedgerAccount>[] = [
    copyableNoColumn('账户号', 'accountNo'),
    { title: '账户名称', dataIndex: 'name', minWidth: 240, render: renderEllipsis },
    { title: '科目', dataIndex: 'code', width: 130, render: (value: PaymentLedgerAccountCode) => PAYMENT_LEDGER_ACCOUNT_CODE_LABELS[value] },
    { title: '余额方向', dataIndex: 'normalBalance', width: 100, render: (value: PaymentLedgerNormalBalance) => NORMAL_BALANCE_LABELS[value] },
    { title: '应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appNameById.get(value) ?? `应用 #${value}`) },
    { title: '商户配置', dataIndex: 'channelConfigId', width: 220, render: (value: number) => renderEllipsis(merchantNameById.get(value) ?? `配置 #${value}`) },
    { title: '币种', dataIndex: 'currency', width: 80 },
    createdAtColumn as ColumnProps<PaymentLedgerAccount>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (value: PaymentLedgerAccount['status']) => <Tag color={value === 'enabled' ? 'green' : 'grey'}>{value === 'enabled' ? '启用' : '停用'}</Tag> },
  ];

  const journalColumns: ColumnProps<PaymentJournal>[] = [
    copyableNoColumn('凭证号', 'journalNo'),
    { title: '来源类型', dataIndex: 'sourceType', width: 150, render: renderEllipsis },
    { title: '来源标识', dataIndex: 'sourceId', width: 180, render: renderEllipsis },
    { title: '摘要', dataIndex: 'description', minWidth: 220, render: renderEllipsis },
    { title: '应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appNameById.get(value) ?? `应用 #${value}`) },
    { title: '商户配置', dataIndex: 'channelConfigId', width: 220, render: (value: number) => renderEllipsis(merchantNameById.get(value) ?? `配置 #${value}`) },
    { title: '币种', dataIndex: 'currency', width: 80 },
    {
      title: '借贷金额', dataIndex: 'lines', width: 150, align: 'right',
      render: (lines: PaymentJournalLine[], record) => formatMinorAmount(amountTotal(lines, 'debitAmount').toString(), record.currency),
    },
    { title: '分录数', dataIndex: 'lines', width: 90, align: 'right', render: (lines: PaymentJournalLine[]) => lines.length },
    {
      title: '凭证类型', dataIndex: 'reversalOfJournalId', width: 100,
      render: (_value: number | null | undefined, record: PaymentJournal) => (
        record.reversalOfJournalId != null
          ? <Tag color="orange">冲正凭证</Tag>
          : record.reversedByJournalId != null
            ? <Tag color="orange">已冲正</Tag>
            : <Tag color="blue">原始凭证</Tag>
      ),
    },
    dateTimeColumn('过账时间', 'postedAt'),
    createOperationColumn<PaymentJournal>({
      width: 120,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => setJournalDetailTarget(record) },
        ...(canReverseJournal && record.reversalOfJournalId == null && record.reversedByJournalId == null && record.sourceType.startsWith('manual.') ? [{ key: 'reverse', label: '冲正', danger: true, onClick: () => openReverse(record) }] : []),
      ],
    }),
  ];

  const reservationColumns: ColumnProps<PaymentFundReservation>[] = [
    copyableNoColumn('预占号', 'reservationNo'),
    { title: '账本账户', dataIndex: 'accountId', width: 200, render: (value: number) => renderEllipsis(accountNameById.get(value) ?? `账户 #${value}`) },
    { title: '来源类型', dataIndex: 'sourceType', width: 140, render: renderEllipsis },
    { title: '来源标识', dataIndex: 'sourceId', width: 180, render: renderEllipsis },
    { title: '金额', dataIndex: 'amount', width: 130, align: 'right', render: (value: string, record) => formatMinorAmount(value, record.currency) },
    { title: '应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appNameById.get(value) ?? `应用 #${value}`) },
    { title: '商户配置', dataIndex: 'channelConfigId', width: 220, render: (value: number) => renderEllipsis(merchantNameById.get(value) ?? `配置 #${value}`) },
    { title: '币种', dataIndex: 'currency', width: 80 },
    { title: '创建原因', dataIndex: 'reason', minWidth: 180, render: renderEllipsis },
    { title: '处理原因', dataIndex: 'finalizationReason', width: 180, render: renderEllipsis },
    dateTimeColumn('到期时间', 'expiresAt', { empty: '不限' }),
    dateTimeColumn('完成时间', 'finalizedAt'),
    { title: '版本', dataIndex: 'version', width: 80, align: 'right', render: (value: number) => `v${value}` },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (value: PaymentFundReservationStatus) => <Tag color={RESERVATION_STATUS_COLORS[value]}>{RESERVATION_STATUS_LABELS[value]}</Tag> },
    createOperationColumn<PaymentFundReservation>({
      width: 150,
      actions: (record) => canReserve && record.status === 'active' ? [
        { key: 'capture', label: '核销', onClick: () => openReservationTransition(record, 'capture') },
        { key: 'release', label: '释放', danger: true, onClick: () => openReservationTransition(record, 'release') },
      ] : [],
    }),
  ];

  const journalLineColumns: ColumnProps<PaymentJournalLine>[] = [
    { title: '行号', dataIndex: 'lineNo', width: 70, align: 'right' },
    copyableNoColumn('账户号', 'accountNo', { width: 300 }),
    { title: '账户名称', dataIndex: 'accountName', width: 240, render: renderEllipsis },
    { title: '借方', dataIndex: 'debitAmount', width: 130, align: 'right', render: (value: string) => formatMinorAmount(value, detailJournal?.currency) },
    { title: '贷方', dataIndex: 'creditAmount', width: 130, align: 'right', render: (value: string) => formatMinorAmount(value, detailJournal?.currency) },
    { title: '摘要', dataIndex: 'memo', width: 220, render: renderEllipsis },
  ];

  const appFilter = (value: number | undefined, onChange: (value: number | undefined) => void) => (
    <FilterSelect
      placeholder="全部应用"
      items={appOptions}
      value={value}
      onChange={(next) => onChange(next as number | undefined)}
      width={150}
    />
  );
  const merchantFilter = (value: number | undefined, onChange: (value: number | undefined) => void) => (
    <FilterSelect
      placeholder="全部商户配置"
      items={merchantOptions}
      value={value}
      onChange={(next) => onChange(next as number | undefined)}
      width={170}
    />
  );
  const currencyFilter = (value: string | undefined, onChange: (value: string | undefined) => void) => (
    <FilterSelect placeholder="全部币种" items={CURRENCY_OPTIONS} value={value} onChange={onChange} />
  );

  return (
    <div className="page-container page-tabs-page">
      {!canView && (
        <Banner type="warning" bordered closeIcon={null} description="当前账号缺少资金工作台查看权限。" style={{ marginBottom: 12 }} />
      )}
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
        <TabPane tab="账本账户" itemKey="accounts">
          <SearchToolbar
            primary={(
              <>
                <KeywordInput placeholder="账户号/账户名称" value={accountSearch.draftParams.keyword} onChange={(keyword) => accountSearch.setDraftParams((prev) => ({ ...prev, keyword }))} onSearch={accountSearch.handleSearch} />
                {appFilter(accountSearch.draftParams.appId, (appId) => accountSearch.setDraftParams((prev) => ({ ...prev, appId })))}
                {merchantFilter(accountSearch.draftParams.channelConfigId, (channelConfigId) => accountSearch.setDraftParams((prev) => ({ ...prev, channelConfigId })))}
                {currencyFilter(accountSearch.draftParams.currency, (currency) => accountSearch.setDraftParams((prev) => ({ ...prev, currency })))}
                <StatusSelect items={ACCOUNT_STATUS_ITEMS} value={accountSearch.draftParams.status} onChange={(status) => accountSearch.setDraftParams((prev) => ({ ...prev, status }))} />
                <SearchButton onClick={accountSearch.handleSearch} disabled={!canView} />
                <ResetButton onClick={accountSearch.handleReset} disabled={!canView} />
                {canCreateAccount && <CreateButton onClick={accountModal.openCreate}>新建账户</CreateButton>}
              </>
            )}
            mobilePrimary={(
              <>
                <KeywordInput placeholder="账户号/账户名称" value={accountSearch.draftParams.keyword} onChange={(keyword) => accountSearch.setDraftParams((prev) => ({ ...prev, keyword }))} onSearch={accountSearch.handleSearch} />
                <SearchButton onClick={accountSearch.handleSearch} disabled={!canView} />
                {canCreateAccount && <CreateButton onClick={accountModal.openCreate}>新建账户</CreateButton>}
              </>
            )}
            mobileFilters={(
              <>
                {appFilter(accountSearch.draftParams.appId, (appId) => accountSearch.setDraftParams((prev) => ({ ...prev, appId })))}
                {merchantFilter(accountSearch.draftParams.channelConfigId, (channelConfigId) => accountSearch.setDraftParams((prev) => ({ ...prev, channelConfigId })))}
                {currencyFilter(accountSearch.draftParams.currency, (currency) => accountSearch.setDraftParams((prev) => ({ ...prev, currency })))}
                <StatusSelect items={ACCOUNT_STATUS_ITEMS} value={accountSearch.draftParams.status} onChange={(status) => accountSearch.setDraftParams((prev) => ({ ...prev, status }))} />
              </>
            )}
            filterTitle="账本账户筛选"
            onFilterApply={accountSearch.handleSearch}
            onFilterReset={accountSearch.handleReset}
          />
          <ConfigurableTable
            bordered columns={accountColumns} dataSource={accountData} loading={accountQuery.isFetching} rowKey="id" empty="暂无账本账户"
            onRefresh={() => void accountQuery.refetch()} refreshLoading={accountQuery.isFetching}
            pagination={accountSearch.buildPagination(accountQuery.data?.total ?? 0)}
          />
        </TabPane>

        <TabPane tab="资金凭证" itemKey="journals">
          <SearchToolbar
            primary={(
              <>
                <KeywordInput placeholder="来源类型" value={journalSearch.draftParams.sourceType} onChange={(sourceType) => journalSearch.setDraftParams((prev) => ({ ...prev, sourceType }))} onSearch={journalSearch.handleSearch} />
                {appFilter(journalSearch.draftParams.appId, (appId) => journalSearch.setDraftParams((prev) => ({ ...prev, appId })))}
                {merchantFilter(journalSearch.draftParams.channelConfigId, (channelConfigId) => journalSearch.setDraftParams((prev) => ({ ...prev, channelConfigId })))}
                {currencyFilter(journalSearch.draftParams.currency, (currency) => journalSearch.setDraftParams((prev) => ({ ...prev, currency })))}
                <DateRangeFilter value={journalSearch.draftParams.timeRange} onChange={(timeRange) => journalSearch.setDraftParams((prev) => ({ ...prev, timeRange }))} width={330} />
                <SearchButton onClick={journalSearch.handleSearch} disabled={!canView} />
                <ResetButton onClick={journalSearch.handleReset} disabled={!canView} />
                {canPostJournal && <CreateButton onClick={openJournalCreate}>新建凭证</CreateButton>}
              </>
            )}
            mobilePrimary={(
              <>
                <KeywordInput placeholder="来源类型" value={journalSearch.draftParams.sourceType} onChange={(sourceType) => journalSearch.setDraftParams((prev) => ({ ...prev, sourceType }))} onSearch={journalSearch.handleSearch} />
                <SearchButton onClick={journalSearch.handleSearch} disabled={!canView} />
                {canPostJournal && <CreateButton onClick={openJournalCreate}>新建凭证</CreateButton>}
              </>
            )}
            mobileFilters={(
              <>
                {appFilter(journalSearch.draftParams.appId, (appId) => journalSearch.setDraftParams((prev) => ({ ...prev, appId })))}
                {merchantFilter(journalSearch.draftParams.channelConfigId, (channelConfigId) => journalSearch.setDraftParams((prev) => ({ ...prev, channelConfigId })))}
                {currencyFilter(journalSearch.draftParams.currency, (currency) => journalSearch.setDraftParams((prev) => ({ ...prev, currency })))}
                <DateRangeFilter value={journalSearch.draftParams.timeRange} onChange={(timeRange) => journalSearch.setDraftParams((prev) => ({ ...prev, timeRange }))} />
              </>
            )}
            filterTitle="资金凭证筛选"
            onFilterApply={journalSearch.handleSearch}
            onFilterReset={journalSearch.handleReset}
          />
          <ConfigurableTable
            bordered columns={journalColumns} dataSource={journalData} loading={journalQuery.isFetching} rowKey="id" empty="暂无资金凭证"
            onRefresh={() => void journalQuery.refetch()} refreshLoading={journalQuery.isFetching}
            pagination={journalSearch.buildPagination(journalQuery.data?.total ?? 0)}
          />
        </TabPane>

        <TabPane tab="资金预占" itemKey="reservations">
          <SearchToolbar
            primary={(
              <>
                <FilterSelect
                  placeholder="全部账户"
                  items={accountOptions}
                  value={reservationSearch.draftParams.accountId}
                  onChange={(accountId) => reservationSearch.setDraftParams((prev) => ({ ...prev, accountId: accountId as number | undefined }))}
                  width={180}
                  filter
                />
                <StatusSelect items={RESERVATION_STATUS_ITEMS} value={reservationSearch.draftParams.status} onChange={(status) => reservationSearch.setDraftParams((prev) => ({ ...prev, status }))} />
                <KeywordInput placeholder="来源类型" value={reservationSearch.draftParams.sourceType} onChange={(sourceType) => reservationSearch.setDraftParams((prev) => ({ ...prev, sourceType }))} onSearch={reservationSearch.handleSearch} />
                <DateRangeFilter value={reservationSearch.draftParams.timeRange} onChange={(timeRange) => reservationSearch.setDraftParams((prev) => ({ ...prev, timeRange }))} width={330} />
                <SearchButton onClick={reservationSearch.handleSearch} disabled={!canView} />
                <ResetButton onClick={reservationSearch.handleReset} disabled={!canView} />
                {canReserve && <CreateButton onClick={reservationModal.openCreate}>新建预占</CreateButton>}
              </>
            )}
            mobilePrimary={(
              <>
                <KeywordInput placeholder="来源类型" value={reservationSearch.draftParams.sourceType} onChange={(sourceType) => reservationSearch.setDraftParams((prev) => ({ ...prev, sourceType }))} onSearch={reservationSearch.handleSearch} />
                <SearchButton onClick={reservationSearch.handleSearch} disabled={!canView} />
                {canReserve && <CreateButton onClick={reservationModal.openCreate}>新建预占</CreateButton>}
              </>
            )}
            mobileFilters={(
              <>
                <FilterSelect
                  placeholder="全部账户"
                  items={accountOptions}
                  value={reservationSearch.draftParams.accountId}
                  onChange={(accountId) => reservationSearch.setDraftParams((prev) => ({ ...prev, accountId: accountId as number | undefined }))}
                  width={180}
                  filter
                />
                <StatusSelect items={RESERVATION_STATUS_ITEMS} value={reservationSearch.draftParams.status} onChange={(status) => reservationSearch.setDraftParams((prev) => ({ ...prev, status }))} />
                <DateRangeFilter value={reservationSearch.draftParams.timeRange} onChange={(timeRange) => reservationSearch.setDraftParams((prev) => ({ ...prev, timeRange }))} />
              </>
            )}
            filterTitle="资金预占筛选"
            onFilterApply={reservationSearch.handleSearch}
            onFilterReset={reservationSearch.handleReset}
          />
          <ConfigurableTable
            bordered columns={reservationColumns} dataSource={reservationData} loading={reservationQuery.isFetching} rowKey="id" empty="暂无资金预占"
            onRefresh={() => void reservationQuery.refetch()} refreshLoading={reservationQuery.isFetching}
            pagination={reservationSearch.buildPagination(reservationQuery.data?.total ?? 0)}
          />
        </TabPane>
      </Tabs>

      <AppModal {...accountModal.modalProps} title="新建账本账户" width={620}>
        <Form key={accountModal.formKey} {...accountModal.formProps}>
          <Form.Input field="name" label="账户名称" maxLength={128} rules={[{ required: true, message: '请输入账户名称' }]} />
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Select field="code" label="科目" style={{ width: '100%' }} optionList={PAYMENT_LEDGER_ACCOUNT_CODES.map((value) => ({ value, label: PAYMENT_LEDGER_ACCOUNT_CODE_LABELS[value] }))} rules={[{ required: true, message: '请选择科目' }]} />
            <Form.Select field="appId" label="支付应用" style={{ width: '100%' }} optionList={appOptions} filter rules={[{ required: true, message: '请选择支付应用' }]} />
            <Form.Select field="channelConfigId" label="商户配置" style={{ width: '100%' }} optionList={merchantOptions} filter rules={[{ required: true, message: '请选择商户配置' }]} />
            <Form.Select field="currency" label="币种" style={{ width: '100%' }} optionList={CURRENCY_OPTIONS} rules={[{ required: true, message: '请选择币种' }]} />
          </div>
        </Form>
      </AppModal>

      <SideSheet
        title="新建资金凭证"
        visible={journalModal.modalProps.visible}
        onCancel={journalModal.modalProps.onCancel}
        width={860}
        closeOnEsc
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={journalModal.modalProps.onCancel}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={journalModal.modalProps.okButtonProps.loading}
              disabled={journalModal.modalProps.okButtonProps.disabled}
              onClick={() => void journalModal.modalProps.onOk()}
            >
              确定
            </Button>
          </div>
        )}
      >
        <Form
          key={journalModal.formKey}
          {...journalModal.formProps}
          onValueChange={(values) => setJournalScope({
            appId: values.appId as number | undefined,
            channelConfigId: values.channelConfigId as number | undefined,
            currency: (values.currency as string | undefined) ?? 'CNY',
          })}
        >
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Select field="appId" label="支付应用" style={{ width: '100%' }} optionList={appOptions} filter rules={[{ required: true, message: '请选择支付应用' }]} />
            <Form.Select field="channelConfigId" label="商户配置" style={{ width: '100%' }} optionList={merchantOptions} filter rules={[{ required: true, message: '请选择商户配置' }]} />
            <Form.Select field="currency" label="币种" style={{ width: '100%' }} optionList={CURRENCY_OPTIONS} rules={[{ required: true, message: '请选择币种' }]} />
          </div>
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Input field="sourceType" label="来源类型" maxLength={64} rules={[{ required: true, message: '请输入来源类型' }]} />
            <Form.Input field="sourceId" label="来源标识" maxLength={128} rules={[{ required: true, message: '请输入来源标识' }]} />
          </div>
          <Form.TextArea field="description" label="凭证摘要" maxCount={512} autosize rows={2} rules={[{ required: true, message: '请输入凭证摘要' }]} />
          <Form.Slot label="分录行">
            <JournalLinesField accountOptions={scopedAccountOptions} />
          </Form.Slot>
        </Form>
      </SideSheet>

      <AppModal {...reservationModal.modalProps} title="新建资金预占" width={720}>
        <Form key={reservationModal.formKey} {...reservationModal.formProps}>
          <Form.Select field="accountId" label="账本账户" style={{ width: '100%' }} optionList={accountOptions} filter rules={[{ required: true, message: '请选择账本账户' }]} />
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Input field="sourceType" label="来源类型" maxLength={64} rules={[{ required: true, message: '请输入来源类型' }]} />
            <Form.Input field="sourceId" label="来源标识" maxLength={128} rules={[{ required: true, message: '请输入来源标识' }]} />
            <Form.Input field="amount" label="金额（最小单位）" placeholder="10000" rules={[{ required: true, message: '请输入金额' }, { pattern: /^[1-9]\d*$/, message: '请输入正整数十进制字符串' }]} />
            <Form.DatePicker field="expiresAt" label="到期时间" type="dateTime" style={{ width: '100%' }} />
          </div>
          <Form.TextArea
            field="reason"
            label="预占原因"
            maxCount={256}
            autosize
            rows={2}
            placeholder="请填写资金用途和预占依据"
            rules={[
              { required: true, message: '请输入预占原因' },
              { validator: (_rule: unknown, value: unknown) => Boolean(String(value ?? '').trim()), message: '预占原因不能只包含空格' },
            ]}
          />
        </Form>
      </AppModal>

      <SideSheet title={detailJournal ? `资金凭证 · ${detailJournal.journalNo}` : '资金凭证详情'} visible={!!journalDetailTarget} onCancel={() => setJournalDetailTarget(null)} width={820} closeOnEsc>
        {detailJournal && (
          <div className="payment-journal-detail">
            <Descriptions
              align="plain"
              layout="horizontal"
              column={2}
              data={[
                { key: '凭证号', value: detailJournal.journalNo },
                { key: '过账时间', value: detailJournal.postedAt },
                { key: '来源', value: `${detailJournal.sourceType} / ${detailJournal.sourceId}`, span: 2 },
                { key: '支付应用', value: appNameById.get(detailJournal.appId) ?? `应用 #${detailJournal.appId}` },
                { key: '商户配置', value: merchantNameById.get(detailJournal.channelConfigId) ?? `配置 #${detailJournal.channelConfigId}` },
                { key: '币种', value: detailJournal.currency },
                {
                  key: '凭证类型',
                  value: detailJournal.reversalOfJournalId != null
                    ? `冲正凭证（原凭证 #${detailJournal.reversalOfJournalId}）`
                    : detailJournal.reversedByJournalId != null
                      ? `已冲正（冲正凭证 #${detailJournal.reversedByJournalId}）`
                      : '原始凭证',
                },
                { key: '摘要', value: detailJournal.description, span: 2 },
              ]}
            />
            <div className="payment-journal-detail__totals">
              <span>借方合计 <strong>{formatMinorAmount(detailDebit.toString(), detailJournal.currency)}</strong></span>
              <span>贷方合计 <strong>{formatMinorAmount(detailCredit.toString(), detailJournal.currency)}</strong></span>
              <Tag color={detailDebit > 0n && detailDebit === detailCredit ? 'green' : 'red'}>
                {detailDebit > 0n && detailDebit === detailCredit ? '借贷平衡' : '借贷不平'}
              </Tag>
            </div>
            <ConfigurableTable bordered columns={journalLineColumns} dataSource={detailJournal.lines} rowKey="id" pagination={false} columnSettings={false} />
            {canReverseJournal && detailJournal.reversalOfJournalId == null && detailJournal.reversedByJournalId == null && (
              <div className="payment-journal-detail__actions">
                <Button type="danger" icon={<RotateCcw size={15} />} onClick={() => openReverse(detailJournal)}>冲正凭证</Button>
              </div>
            )}
          </div>
        )}
      </SideSheet>

      <AppModal
        title="冲正资金凭证"
        visible={!!reverseTarget}
        onCancel={closeReverse}
        onOk={submitReverse}
        okText="继续确认"
        okButtonProps={{ type: 'danger', theme: 'solid', loading: reverseMutation.isPending }}
        width={520}
        closeOnEsc
      >
        {reverseTarget && (
          <Form labelPosition="left" labelWidth={100}>
            <Form.Slot label="凭证号">{reverseTarget.journalNo}</Form.Slot>
            <Form.Slot label="借贷金额">{formatMinorAmount(amountTotal(reverseTarget.lines, 'debitAmount').toString(), reverseTarget.currency)}</Form.Slot>
            <Form.Slot label="冲正原因">
              <TextArea value={reverseReason} onChange={setReverseReason} maxCount={512} autosize rows={3} placeholder="请填写冲正依据（必填）" />
            </Form.Slot>
          </Form>
        )}
      </AppModal>

      <AppModal
        title={reservationTransitionAction === 'release' ? '释放资金预占' : '核销资金预占'}
        visible={!!reservationTransitionTarget}
        onCancel={closeReservationTransition}
        onOk={submitReservationTransition}
        okText="继续确认"
        okButtonProps={{
          loading: captureMutation.isPending || releaseMutation.isPending,
          ...(reservationTransitionAction === 'release' ? { type: 'danger' as const, theme: 'solid' as const } : {}),
        }}
        width={520}
        closeOnEsc
      >
        {reservationTransitionTarget && (
          <Form labelPosition="left" labelWidth={100}>
            <Form.Slot label="预占号">{reservationTransitionTarget.reservationNo}</Form.Slot>
            <Form.Slot label="预占金额">{formatMinorAmount(reservationTransitionTarget.amount, reservationTransitionTarget.currency)}</Form.Slot>
            <Form.Slot label="当前版本">v{reservationTransitionTarget.version}</Form.Slot>
            <Form.Slot label="处理原因">
              <TextArea value={reservationTransitionReason} onChange={setReservationTransitionReason} maxCount={256} autosize rows={3} placeholder="请填写处理依据（必填）" />
            </Form.Slot>
          </Form>
        )}
      </AppModal>
    </div>
  );
}

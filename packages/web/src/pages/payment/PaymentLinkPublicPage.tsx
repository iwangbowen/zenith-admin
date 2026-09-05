import { useEffect, useMemo, useRef, useState } from 'react';
import './PaymentLinkPublicPage.css';
import { formatYuan, getPaymentQrInstruction } from '@/utils/payment';
import { copyText } from '@/utils/clipboard';
import { useParams, useSearchParams } from 'react-router-dom';
import { Banner, Button, Form, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Copy, ExternalLink, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import dayjs from 'dayjs';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_LINK_PAY_METHODS, PAYMENT_METHOD_LABELS, type PaymentCashierMethod, type PaymentLinkPublic } from '@zenith/shared/payment';
import { usePayPublicPaymentLink, usePublicPaymentCashierSession, usePublicPaymentLink } from '@/hooks/queries/payment-links';

const yuan = (cents: number | null | undefined) => formatYuan(cents, '自定义金额');

/** 待支付倒计时（按订单 expiredAt，每秒刷新，到期返回 null） */
function useCountdown(expiredAt: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiredAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiredAt]);
  if (!expiredAt) return null;
  const remain = Math.floor((dayjs(expiredAt).valueOf() - now) / 1000);
  if (remain <= 0) return null;
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 聚合收银台环境识别：根据 UA 判断运行环境，推荐/过滤合适的支付方式（一码多付核心）。 */
type CashierEnv = 'wechat' | 'alipay' | 'mobile' | 'desktop';

function detectCashierEnv(): CashierEnv {
  const ua = navigator.userAgent;
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/AlipayClient/i.test(ua)) return 'alipay';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** 各环境可用的支付方式（按推荐顺序）：
 * 微信内置浏览器：H5/扫码均被拦截且 JSAPI 需 OAuth（未开放公开页）→ 引导外部浏览器打开；
 * 支付宝内置浏览器：直接唤起支付宝 WAP 收银台；
 * 手机浏览器：微信 H5 / 支付宝 WAP / 云闪付；桌面：扫码 / 电脑网站。 */
const ENV_METHODS: Record<CashierEnv, PaymentCashierMethod[]> = {
  wechat: [],
  alipay: ['alipay_wap'],
  mobile: ['wechat_h5', 'alipay_wap', 'unionpay_qr'],
  desktop: ['wechat_native', 'alipay_page', 'unionpay_qr'],
};

interface PayFormValues {
  amountYuan?: number;
  payMethod?: PaymentCashierMethod;
}

export default function PaymentLinkPublicPage() {
  const { token = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionToken = searchParams.get('session')?.trim() || undefined;
  const formApi = useRef<FormApi | null>(null);
  const linkQuery = usePublicPaymentLink(token);
  const payMutation = usePayPublicPaymentLink();
  const link: PaymentLinkPublic | null = linkQuery.data ?? null;
  const sessionQuery = usePublicPaymentCashierSession(token, sessionToken);
  const session = sessionQuery.data ?? null;
  const payResult = session?.payParams ?? null;
  const orderNo = session?.orderNo ?? null;
  const countdown = useCountdown(session?.expiresAt);

  const env = useMemo(detectCashierEnv, []);
  // 服务端启用能力 ∩ 当前浏览器环境；服务端列表是租户、固定方式与启停状态的权威结果。
  const availableMethods = useMemo(() => {
    const envMethods = ENV_METHODS[env];
    return (link?.availableMethods ?? []).filter((item) => envMethods.includes(item.method));
  }, [env, link?.availableMethods]);
  const methodOptions = useMemo(
    () => availableMethods.map((item) => ({ value: item.method, label: item.label })),
    [availableMethods],
  );
  const fixedMethodOption = link?.payMethod
    ? link.availableMethods.find((item) => item.method === link.payMethod)
    : undefined;
  const unsupportedFixedMethod = !!link?.payMethod && !fixedMethodOption;
  const wechatInAppBlocked = env === 'wechat' && !unsupportedFixedMethod && (link?.availableMethods.length ?? 0) > 0;
  const methodUnavailable = !wechatInAppBlocked && !unsupportedFixedMethod && availableMethods.length === 0;

  useEffect(() => {
    if (linkQuery.error instanceof Error) Toast.error(linkQuery.error.message);
  }, [linkQuery.error]);

  useEffect(() => {
    if (sessionQuery.error instanceof Error) Toast.error(sessionQuery.error.message);
  }, [sessionQuery.error]);

  const refetchLink = linkQuery.refetch;
  useEffect(() => {
    if (session?.status === 'succeeded') void refetchLink();
  }, [session?.status, refetchLink]);

  // 智能默认：按环境推荐的首个方式自动选中
  useEffect(() => {
    if (link && !link.payMethod && !wechatInAppBlocked && availableMethods.length > 0) {
      formApi.current?.setValue('payMethod', availableMethods[0].method);
    }
  }, [link, availableMethods, wechatInAppBlocked]);

  async function submitPay() {
    if (!link || link.status !== 'active') return;
    let values: PayFormValues;
    try { values = (await formApi.current?.validate()) as PayFormValues; } catch { return; }
    const payMethod: PaymentCashierMethod | undefined = link.payMethod ? fixedMethodOption?.method : values.payMethod;
    if (!payMethod) {
      Toast.error('请选择支付方式');
      return;
    }
    if (!link.availableMethods.some((item) => item.method === payMethod)) {
      Toast.error('该支付方式当前未启用或不属于此收款链接');
      return;
    }
    if (!availableMethods.some((item) => item.method === payMethod)) {
      Toast.error('该支付方式不适用于当前浏览器环境');
      return;
    }
    const amount = link.amount ?? Math.round((values.amountYuan ?? 0) * 100);
    if (!amount || amount <= 0) {
      Toast.error('请输入有效的支付金额');
      return;
    }

    try {
      const res = await payMutation.mutateAsync({
        params: { token },
        body: {
          amount: link.amount == null ? amount : undefined,
          payMethod: link.payMethod == null ? enumValueOf(PAYMENT_LINK_PAY_METHODS, payMethod) : undefined,
        },
      });
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set('session', res.sessionToken);
      setSearchParams(nextSearchParams, { replace: true });
      Toast.success('下单成功');
      // 移动端跳转类支付直接唤起收银台，减少一步点击
      if (res.payParams?.payUrl && (env === 'alipay' || env === 'mobile')) {
        window.location.href = res.payParams.payUrl;
      }
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '下单失败');
    }
  }

  const disabled = !link || link.status !== 'active' || unsupportedFixedMethod || wechatInAppBlocked || methodUnavailable;

  let cashierStatus = { label: '待支付', tone: 'pending' };
  if (!link) cashierStatus = { label: linkQuery.isFetching ? '加载中' : '不可用', tone: 'muted' };
  else if (session?.status === 'succeeded') cashierStatus = { label: '支付成功', tone: 'success' };
  else if (session?.status === 'failed') cashierStatus = { label: '支付失败', tone: 'danger' };
  else if (session?.status === 'expired') cashierStatus = { label: '会话已过期', tone: 'muted' };
  else if (session?.status === 'unknown') cashierStatus = { label: '结果待确认', tone: 'processing' };
  else if (sessionToken && sessionQuery.isError) cashierStatus = { label: '会话不可用', tone: 'danger' };
  else if (link.status !== 'active' || unsupportedFixedMethod || methodUnavailable) cashierStatus = { label: '当前不可支付', tone: 'danger' };
  else if (sessionToken) cashierStatus = { label: session ? '等待付款' : '恢复会话中', tone: 'processing' };
  const secureContext = globalThis.isSecureContext === true;

  function clearSession() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete('session');
    setSearchParams(nextSearchParams, { replace: true });
  }

  async function copyPageUrl() {
    if (await copyText(window.location.href)) {
      Toast.success('链接已复制，请在浏览器中打开');
    } else {
      Toast.info('请通过右上角菜单选择「在浏览器打开」');
    }
  }

  return (
    <main className="payment-cashier">
      <header className="payment-cashier__header">
        <div className="payment-cashier__inner payment-cashier__header-inner">
          <div className="payment-cashier__security-title">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>安全收银台</span>
          </div>
          <Typography.Title heading={3} className="payment-cashier__subject">
            {link?.subject ?? '收款信息'}
          </Typography.Title>
        </div>
      </header>

      <section className="payment-cashier__summary" aria-label="收款概要">
        <div className="payment-cashier__inner">
          <div className="payment-cashier__amount-block">
            <Typography.Text type="tertiary">支付金额</Typography.Text>
            <div className="payment-cashier__amount">{session ? yuan(session.amount) : link ? yuan(link.amount) : '—'}</div>
          </div>

          {link?.status === 'active' && (link.remainingUses != null || link.expiredAt) && (
            <Space spacing={8} wrap className="payment-cashier__limits">
              {link.remainingUses != null && <Tag color="blue">剩余 {link.remainingUses} 次</Tag>}
              {link.expiredAt && <Tag color="grey">有效期至 {link.expiredAt}</Tag>}
            </Space>
          )}

          <dl className="payment-cashier__meta">
            <div className="payment-cashier__meta-order">
              <dt>订单号</dt>
              <dd title={orderNo ?? '待创建'}>{orderNo ?? '待创建'}</dd>
            </div>
            <div>
              <dt>支付状态</dt>
              <dd className={`payment-cashier__status payment-cashier__status--${cashierStatus.tone}`}>{cashierStatus.label}</dd>
            </div>
            <div>
              <dt>安全状态</dt>
              <dd className={secureContext ? 'payment-cashier__secure' : 'payment-cashier__insecure'}>
                <ShieldCheck size={15} aria-hidden="true" />
                {secureContext ? '安全环境' : '连接未加密'}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="payment-cashier__operation" aria-live="polite">
        <div className="payment-cashier__inner">
          <Spin spinning={linkQuery.isFetching || (!!sessionToken && sessionQuery.isFetching)} tip="正在加载收款信息" wrapperClassName="payment-cashier__spin">
            <div className="payment-cashier__stage">
              {link ? (
                session?.status === 'succeeded' ? (
                  <div className="payment-cashier__state">
                    <CheckCircle2 className="payment-cashier__state-icon payment-cashier__state-icon--success" size={56} aria-hidden="true" />
                    <Typography.Title heading={4}>支付成功</Typography.Title>
                    <Typography.Text type="tertiary">款项已到账，订单状态已确认</Typography.Text>
                  </div>
                ) : sessionToken && sessionQuery.isError ? (
                  <div className="payment-cashier__state">
                    <XCircle className="payment-cashier__state-icon payment-cashier__state-icon--danger" size={56} aria-hidden="true" />
                    <Typography.Title heading={4}>支付会话不可用</Typography.Title>
                    <Typography.Text type="tertiary">会话不存在、已失效或与当前收款链接不匹配。</Typography.Text>
                    <Button type="primary" icon={<RefreshCw size={16} />} onClick={clearSession}>重新发起支付</Button>
                  </div>
                ) : sessionToken && !session ? (
                  <div className="payment-cashier__state">
                    <Spin spinning />
                    <Typography.Text type="tertiary">正在恢复支付会话</Typography.Text>
                  </div>
                ) : link.status !== 'active' ? (
                  <div className="payment-cashier__state">
                    <XCircle className="payment-cashier__state-icon" size={56} aria-hidden="true" />
                    <Typography.Title heading={4}>
                      {link.unavailableReason === 'usage_limit'
                        ? '收款次数已用完'
                        : link.status === 'expired' ? '收款链接已过期' : '收款链接已停用'}
                    </Typography.Title>
                    <Typography.Text type="tertiary">
                      {link.unavailableReason === 'usage_limit' ? '该收款链接已达到使用次数上限。' : '请联系商户获取新的收款链接。'}
                    </Typography.Text>
                  </div>
                ) : unsupportedFixedMethod ? (
                  <div className="payment-cashier__state">
                    <XCircle className="payment-cashier__state-icon" size={56} aria-hidden="true" />
                    <Typography.Title heading={4}>支付方式不可用</Typography.Title>
                    <Typography.Text type="tertiary">该收款方式当前未启用或未配置可用商户。</Typography.Text>
                  </div>
                ) : methodUnavailable ? (
                  <div className="payment-cashier__state">
                    <XCircle className="payment-cashier__state-icon" size={56} aria-hidden="true" />
                    <Typography.Title heading={4}>
                      {link.availableMethods.length === 0 ? '暂无可用支付方式' : '当前浏览器不支持此支付方式'}
                    </Typography.Title>
                    <Typography.Text type="tertiary">
                      {link.availableMethods.length === 0 ? '请联系商户检查支付配置。' : '请更换浏览器或设备后重试。'}
                    </Typography.Text>
                  </div>
                ) : !session ? (
                  <div className="payment-cashier__form">
                    <Typography.Title heading={5}>确认支付信息</Typography.Title>
                    <Form getFormApi={(api) => { formApi.current = api; }} labelPosition="top">
                      {wechatInAppBlocked && (
                        <Banner
                          type="info"
                          closeIcon={null}
                          className="payment-cashier__banner"
                          description="微信内暂不支持直接支付，请在手机浏览器中打开当前链接。"
                        />
                      )}
                      {link.amount == null && (
                        <Form.InputNumber
                          field="amountYuan"
                          label="金额(元)"
                          min={0.01}
                          precision={2}
                          style={{ width: '100%' }}
                          rules={[{ required: true, message: '请输入支付金额' }]}
                        />
                      )}
                      {link.payMethod == null ? (
                        <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} disabled={wechatInAppBlocked} rules={[{ required: true, message: '请选择支付方式' }]} />
                      ) : (
                        <Form.Slot label="支付方式">{fixedMethodOption?.label ?? PAYMENT_METHOD_LABELS[link.payMethod]}</Form.Slot>
                      )}
                      {wechatInAppBlocked ? (
                        <Button type="primary" block icon={<Copy size={16} />} onClick={copyPageUrl}>复制支付链接</Button>
                      ) : (
                        <Button type="primary" block loading={payMutation.isPending} disabled={disabled} onClick={submitPay}>立即支付</Button>
                      )}
                    </Form>
                  </div>
                ) : session.status === 'failed' || session.status === 'expired' ? (
                  <div className="payment-cashier__state">
                    <XCircle className="payment-cashier__state-icon payment-cashier__state-icon--danger" size={56} aria-hidden="true" />
                    <Typography.Title heading={4}>{session.status === 'failed' ? '支付失败' : '支付会话已过期'}</Typography.Title>
                    {session.errorMessage && <Typography.Text type="tertiary">{session.errorMessage}</Typography.Text>}
                    <Button
                      type="primary"
                      icon={<RefreshCw size={16} />}
                      onClick={clearSession}
                    >
                      重新发起支付
                    </Button>
                  </div>
                ) : (
                  <div className="payment-cashier__paying">
                    <Typography.Title heading={5}>请完成支付</Typography.Title>
                    <div className="payment-cashier__countdown">{countdown ? `剩余 ${countdown}` : '正在确认订单状态'}</div>
                    {payResult?.codeUrl && (
                      <>
                        <div className="payment-cashier__qr-frame">
                          <QRCodeSVG value={payResult.codeUrl} size={220} className="payment-cashier__qr" />
                        </div>
                        <Typography.Text type="tertiary">{getPaymentQrInstruction(session.payMethod)}</Typography.Text>
                      </>
                    )}
                    {payResult?.payUrl && (
                      <Button type="primary" icon={<ExternalLink size={16} />} onClick={() => window.open(payResult.payUrl, '_blank', 'noopener')}>打开支付页</Button>
                    )}
                    {payResult?.appOrderStr && (
                      <Typography.Paragraph copyable className="payment-cashier__app-order">
                        {payResult.appOrderStr}
                      </Typography.Paragraph>
                    )}
                    <div className="payment-cashier__waiting">
                      <Spin size="small" spinning />
                      <Typography.Text type="tertiary">等待支付结果</Typography.Text>
                    </div>
                  </div>
                )
              ) : (
                <div className="payment-cashier__state">
                  <XCircle className="payment-cashier__state-icon" size={56} aria-hidden="true" />
                  <Typography.Title heading={4}>支付链接不可用</Typography.Title>
                  <Typography.Text type="tertiary">请确认链接是否正确或联系商户重新发送。</Typography.Text>
                </div>
              )}
            </div>
          </Spin>
        </div>
      </section>
    </main>
  );
}

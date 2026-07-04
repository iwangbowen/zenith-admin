import { useEffect, useMemo, useRef, useState } from 'react';
import { formatYuan } from '@/utils/payment';
import { useParams } from 'react-router-dom';
import { Banner, Button, Card, Form, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { QRCodeSVG } from 'qrcode.react';
import { PAYMENT_LINK_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { CreatePaymentResult, PaymentLinkPublic, PaymentLinkStatus, PaymentMethod } from '@zenith/shared';
import { usePayPublicPaymentLink, usePublicPaymentLink } from '@/hooks/queries/payment-links';

const yuan = (cents: number | null | undefined) => formatYuan(cents, '自定义金额');
const publicPayMethods: PaymentMethod[] = ['wechat_native', 'wechat_h5', 'alipay_page', 'alipay_wap', 'unionpay_qr'];
const LINK_STATUS_COLOR = { active: 'green', disabled: 'grey', expired: 'red' } as const satisfies Record<PaymentLinkStatus, string>;

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
const ENV_METHODS: Record<CashierEnv, PaymentMethod[]> = {
  wechat: [],
  alipay: ['alipay_wap'],
  mobile: ['wechat_h5', 'alipay_wap', 'unionpay_qr'],
  desktop: ['wechat_native', 'alipay_page', 'unionpay_qr'],
};

interface PayFormValues {
  amountYuan?: number;
  payMethod?: PaymentMethod;
}

export default function PaymentLinkPublicPage() {
  const { token = '' } = useParams();
  const formApi = useRef<FormApi | null>(null);
  const [payResult, setPayResult] = useState<CreatePaymentResult | null>(null);
  const linkQuery = usePublicPaymentLink(token);
  const payMutation = usePayPublicPaymentLink();
  const link: PaymentLinkPublic | null = linkQuery.data ?? null;

  const env = useMemo(detectCashierEnv, []);
  // 环境可用方式 ∩ 公开页支持方式；链接固定方式时不做环境过滤（保持商户设定）
  const availableMethods = useMemo(() => {
    if (link?.payMethod) return publicPayMethods.includes(link.payMethod) ? [link.payMethod] : [];
    const envMethods = ENV_METHODS[env];
    return envMethods.length > 0 ? envMethods : publicPayMethods;
  }, [env, link?.payMethod]);
  const methodOptions = useMemo(
    () => availableMethods.map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] })),
    [availableMethods],
  );
  const wechatInAppBlocked = env === 'wechat' && !link?.payMethod;

  useEffect(() => {
    if (linkQuery.error instanceof Error) Toast.error(linkQuery.error.message);
  }, [linkQuery.error]);

  // 智能默认：按环境推荐的首个方式自动选中
  useEffect(() => {
    if (link && !link.payMethod && !wechatInAppBlocked && availableMethods.length > 0) {
      formApi.current?.setValue('payMethod', availableMethods[0]);
    }
  }, [link, availableMethods, wechatInAppBlocked]);

  async function submitPay() {
    if (!link || link.status !== 'active') return;
    let values: PayFormValues;
    try { values = (await formApi.current?.validate()) as PayFormValues; } catch { return; }
    const payMethod = link.payMethod ?? values.payMethod;
    if (!payMethod) {
      Toast.error('请选择支付方式');
      return;
    }
    if (!publicPayMethods.includes(payMethod)) {
      Toast.error('该支付方式暂不支持在公开收款页发起');
      return;
    }
    const amount = link.amount ?? Math.round((values.amountYuan ?? 0) * 100);
    if (!amount || amount <= 0) {
      Toast.error('请输入有效的支付金额');
      return;
    }

    try {
      const res = await payMutation.mutateAsync({
        token,
        amount: link.amount == null ? amount : undefined,
        payMethod: link.payMethod == null ? payMethod : undefined,
      });
      Toast.success('下单成功');
      // 移动端跳转类支付直接唤起收银台，减少一步点击
      if (res.payParams.payUrl && (env === 'alipay' || env === 'mobile')) {
        window.location.href = res.payParams.payUrl;
      }
      setPayResult(res.payParams);
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '下单失败');
    }
  }

  const unsupportedFixedMethod = !!link?.payMethod && !publicPayMethods.includes(link.payMethod);
  const disabled = !link || link.status !== 'active' || unsupportedFixedMethod || wechatInAppBlocked;

  async function copyPageUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      Toast.success('链接已复制，请在浏览器中打开');
    } catch {
      Toast.info('请通过右上角菜单选择「在浏览器打开」');
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f0fdf4 0%, #f8fafc 42%, #ffffff 100%)', padding: '40px 16px' }}>
      <Card style={{ maxWidth: 460, margin: '0 auto' }} bodyStyle={{ padding: 24 }}>
        <Spin spinning={linkQuery.isFetching}>
          {link ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ textAlign: 'center' }}>
                <Typography.Title heading={4} style={{ marginBottom: 8 }}>{link.subject}</Typography.Title>
                <Typography.Text type="tertiary">{link.bizType}</Typography.Text>
              </div>

              <div style={{ textAlign: 'center', padding: '18px 12px', borderRadius: 10, background: 'var(--semi-color-bg-1)', border: '1px solid var(--semi-color-border)' }}>
                <Typography.Text type="tertiary">支付金额</Typography.Text>
                <div style={{ marginTop: 6, fontSize: 30, fontWeight: 700, color: '#10b981' }}>{yuan(link.amount)}</div>
              </div>

              <Space spacing={8}>
                <Tag color={LINK_STATUS_COLOR[link.status]}>{PAYMENT_LINK_STATUS_LABELS[link.status]}</Tag>
                {link.remainingUses != null && <Tag color="blue">剩余 {link.remainingUses} 次</Tag>}
                {link.expiredAt && <Tag color="grey">有效期至 {link.expiredAt}</Tag>}
                {unsupportedFixedMethod && <Tag color="red">当前支付方式不支持网页收款</Tag>}
              </Space>

              {!payResult ? (
                <Form getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={86}>
                  {wechatInAppBlocked && (
                    <Banner
                      type="info"
                      closeIcon={null}
                      style={{ marginBottom: 12 }}
                      description="微信内暂不支持直接支付，请复制链接后在手机浏览器中打开完成付款。"
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
                    <Form.Slot label="支付方式">{PAYMENT_METHOD_LABELS[link.payMethod]}</Form.Slot>
                  )}
                  {wechatInAppBlocked ? (
                    <Button type="primary" block onClick={copyPageUrl}>复制链接去浏览器支付</Button>
                  ) : (
                    <Button type="primary" block loading={payMutation.isPending} disabled={disabled} onClick={submitPay}>立即支付</Button>
                  )}
                </Form>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <Typography.Title heading={6}>请完成支付</Typography.Title>
                  {payResult.codeUrl && (
                    <>
                      <QRCodeSVG value={payResult.codeUrl} size={220} style={{ margin: '12px auto', display: 'block' }} />
                      <Typography.Text type="tertiary">请使用微信扫码支付</Typography.Text>
                    </>
                  )}
                  {payResult.payUrl && (
                    <div style={{ marginTop: 12 }}>
                      <Button type="primary" onClick={() => window.open(payResult.payUrl, '_blank', 'noopener')}>打开支付页</Button>
                    </div>
                  )}
                  {payResult.appOrderStr && (
                    <Typography.Paragraph copyable style={{ wordBreak: 'break-all', textAlign: 'left', marginTop: 12 }}>
                      {payResult.appOrderStr}
                    </Typography.Paragraph>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <Typography.Title heading={5}>支付链接不可用</Typography.Title>
              <Typography.Text type="tertiary">请确认链接是否正确或联系商户重新发送。</Typography.Text>
            </div>
          )}
        </Spin>
      </Card>
    </div>
  );
}

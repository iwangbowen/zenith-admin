import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Form, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { QRCodeSVG } from 'qrcode.react';
import { request } from '@/utils/request';
import { PAYMENT_LINK_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { CreatePaymentResult, PaymentLinkPublic, PaymentLinkStatus, PaymentMethod } from '@zenith/shared';

const yuan = (cents: number | null | undefined) => (cents == null ? '自定义金额' : `¥${(cents / 100).toFixed(2)}`);
const publicPayMethods: PaymentMethod[] = ['wechat_native', 'wechat_h5', 'alipay_page', 'alipay_wap'];
const methodOptions = publicPayMethods.map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));
const LINK_STATUS_COLOR = { active: 'green', disabled: 'grey', expired: 'red' } as const satisfies Record<PaymentLinkStatus, string>;

function paymentLinkApi(token: string) {
  return `/api/public/payment/link/${encodeURIComponent(token)}`;
}

interface PayFormValues {
  amountYuan?: number;
  payMethod?: PaymentMethod;
}

export default function PaymentLinkPublicPage() {
  const { token = '' } = useParams();
  const formApi = useRef<FormApi | null>(null);
  const [link, setLink] = useState<PaymentLinkPublic | null>(null);
  const [payResult, setPayResult] = useState<CreatePaymentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    request
      .get<PaymentLinkPublic>(paymentLinkApi(token), { skipAuth: true, silent: true })
      .then((res) => {
        if (cancelled) return;
        if (res.code === 0) setLink(res.data);
        else Toast.error(res.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

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

    setSubmitting(true);
    try {
      const res = await request.post<{ orderNo: string; payParams: CreatePaymentResult }>(
        `${paymentLinkApi(token)}/pay`,
        {
          amount: link.amount == null ? amount : undefined,
          payMethod: link.payMethod == null ? payMethod : undefined,
        },
        { skipAuth: true, silent: true },
      );
      if (res.code === 0) {
        Toast.success('下单成功');
        setPayResult(res.data.payParams);
      } else {
        Toast.error(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const unsupportedFixedMethod = !!link?.payMethod && !publicPayMethods.includes(link.payMethod);
  const disabled = !link || link.status !== 'active' || unsupportedFixedMethod;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f0fdf4 0%, #f8fafc 42%, #ffffff 100%)', padding: '40px 16px' }}>
      <Card style={{ maxWidth: 460, margin: '0 auto' }} bodyStyle={{ padding: 24 }}>
        <Spin spinning={loading}>
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
                    <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} rules={[{ required: true, message: '请选择支付方式' }]} />
                  ) : (
                    <Form.Slot label="支付方式">{PAYMENT_METHOD_LABELS[link.payMethod]}</Form.Slot>
                  )}
                  <Button type="primary" block loading={submitting} disabled={disabled} onClick={submitPay}>立即支付</Button>
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

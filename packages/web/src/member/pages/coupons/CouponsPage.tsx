import { type ReactNode } from 'react';
import { Tabs, TabPane, Button, Toast, Spin, Tag, Modal } from '@douyinfe/semi-ui';
import dayjs from 'dayjs';
import type { Coupon } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import {
  useAvailableCoupons,
  useExchangeCoupon,
  useExchangeableCoupons,
  useInfiniteMemberCoupons,
  useMemberPointAccount,
  useReceiveCoupon,
} from '../../hooks/queries';

const STATUS_TAG: Record<string, ReactNode> = {
  unused: <Tag color="green">可用</Tag>,
  used: <Tag color="grey">已使用</Tag>,
  expired: <Tag color="grey">已过期</Tag>,
  frozen: <Tag color="orange">已冻结</Tag>,
};

function couponValue(coupon: Coupon) {
  if (coupon.type === 'amount') {
    return (
      <span className="m-coupon-value">
        ¥{coupon.faceValue / 100}
      </span>
    );
  }
  return (
    <span className="m-coupon-value">
      {coupon.faceValue / 10}
      <small>折</small>
    </span>
  );
}

function validityText(coupon: Coupon): string {
  if (coupon.validType === 'relative') {
    return `领取后 ${coupon.validDays ?? 0} 天内有效`;
  }
  const start = coupon.validStart?.slice(0, 10) ?? '';
  const end = coupon.validEnd?.slice(0, 10) ?? '';
  return start || end ? `${start} 至 ${end}` : '长期有效';
}

interface CouponCardProps {
  coupon: Coupon;
  disabled?: boolean;
  extra?: ReactNode;
  subDate?: string;
}

function CouponCard({ coupon, disabled, extra, subDate }: Readonly<CouponCardProps>) {
  return (
    <div className="m-coupon">
      <div className={`m-coupon-left${disabled ? ' disabled' : ''}`}>
        {couponValue(coupon)}
        <span className="m-coupon-threshold">
          {coupon.threshold > 0 ? `满${coupon.threshold / 100}元可用` : '无门槛'}
        </span>
      </div>
      <div className="m-coupon-right">
        <div className="m-coupon-name">{coupon.name}</div>
        <div className="m-coupon-date">{subDate ?? validityText(coupon)}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>{extra}</div>
      </div>
    </div>
  );
}

function MyCoupons() {
  const query = useInfiniteMemberCoupons(10);
  const list = query.data?.pages.flatMap((page) => page.list) ?? [];
  const soonThreshold = dayjs().add(7, 'day');

  if (query.isFetching && list.length === 0) {
    return <div className="m-loading-wrap"><Spin /></div>;
  }
  if (list.length === 0) {
    return <div className="m-empty">暂无优惠券，去领券中心看看吧</div>;
  }

  return (
    <div style={{ paddingTop: 12 }}>
      {list.map((mc) => {
        if (!mc.coupon) return null;
        // 7 天内到期的可用券高亮提醒
        const expiringSoon = mc.status === 'unused' && !!mc.expireAt && dayjs(mc.expireAt).isBefore(soonThreshold);
        return (
          <CouponCard
            key={mc.id}
            coupon={mc.coupon}
            disabled={mc.status !== 'unused'}
            subDate={mc.expireAt ? `有效期至 ${mc.expireAt.slice(0, 10)}` : undefined}
            extra={
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {expiringSoon && <Tag color="red" size="small">即将过期</Tag>}
                {STATUS_TAG[mc.status]}
              </span>
            }
          />
        );
      })}
      {query.hasNextPage && (
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <Button theme="borderless" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}

function AvailableCoupons() {
  const query = useAvailableCoupons();
  const receiveMutation = useReceiveCoupon();
  const list = query.data ?? [];

  const receive = async (couponId: number) => {
    await receiveMutation.mutateAsync(couponId);
    Toast.success('领取成功');
  };

  if (query.isFetching) {
    return <div className="m-loading-wrap"><Spin /></div>;
  }
  if (list.length === 0) {
    return <div className="m-empty">暂无可领取的优惠券</div>;
  }

  return (
    <div style={{ paddingTop: 12 }}>
      {list.map((c) => (
        <CouponCard
          key={c.id}
          coupon={c}
          extra={
            <Button
              size="small"
              theme="solid"
              loading={receiveMutation.isPending && receiveMutation.variables === c.id}
              onClick={() => receive(c.id)}
              style={{ background: 'var(--m-primary)' }}
            >
              立即领取
            </Button>
          }
        />
      ))}
    </div>
  );
}

function ExchangeCoupons() {
  const query = useExchangeableCoupons();
  const pointQuery = useMemberPointAccount();
  const exchangeMutation = useExchangeCoupon();
  const list = query.data ?? [];
  const balance = pointQuery.data?.balance ?? 0;

  const exchange = (coupon: Coupon) => {
    const cost = coupon.exchangePoints ?? 0;
    Modal.confirm({
      title: `兑换「${coupon.name}」？`,
      content: `将消耗 ${cost} 积分（当前余额 ${balance}）`,
      okText: '确认兑换',
      onOk: async () => {
        await exchangeMutation.mutateAsync(coupon.id);
        Toast.success('兑换成功');
      },
    });
  };

  if (query.isFetching) {
    return <div className="m-loading-wrap"><Spin /></div>;
  }
  if (list.length === 0) {
    return <div className="m-empty">暂无可兑换的优惠券</div>;
  }

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 8 }}>
        当前积分余额：<strong style={{ color: 'var(--m-primary)' }}>{balance}</strong>
      </div>
      {list.map((c) => {
        const cost = c.exchangePoints ?? 0;
        const enough = balance >= cost;
        return (
          <CouponCard
            key={c.id}
            coupon={c}
            extra={
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--m-warning)' }}>{cost} 积分</span>
                <Button
                  size="small"
                  theme="solid"
                  disabled={!enough}
                  loading={exchangeMutation.isPending && exchangeMutation.variables === c.id}
                  onClick={() => exchange(c)}
                  style={enough ? { background: 'var(--m-primary)' } : undefined}
                >
                  {enough ? '立即兑换' : '积分不足'}
                </Button>
              </span>
            }
          />
        );
      })}
    </div>
  );
}

export default function CouponsPage() {
  return (
    <MemberPage title="我的卡券">
      <Tabs type="line">
        <TabPane tab="我的卡券" itemKey="mine">
          <MyCoupons />
        </TabPane>
        <TabPane tab="领券中心" itemKey="available">
          <AvailableCoupons />
        </TabPane>
        <TabPane tab="积分兑换" itemKey="exchange">
          <ExchangeCoupons />
        </TabPane>
      </Tabs>
    </MemberPage>
  );
}

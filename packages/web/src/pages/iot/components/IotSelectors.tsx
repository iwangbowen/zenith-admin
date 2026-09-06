import { useAllIotGroups } from '@/hooks/queries/iot-groups';
import { useIotDeviceList } from '@/hooks/queries/iot-devices';
import { useAllIotProducts } from '@/hooks/queries/iot-products';

export function useIotProductOptions() {
  const query = useAllIotProducts();
  const items = query.data ?? [];
  return {
    items,
    options: items.map((p) => ({ value: p.id, label: p.name })),
    isFetching: query.isFetching,
  };
}

export function useIotDeviceOptions(productId: number | null | undefined, enabled = true) {
  const query = useIotDeviceList(
    { page: 1, pageSize: 100, productId: productId ?? undefined },
    enabled && productId != null,
  );
  const items = query.data?.list ?? [];
  return {
    items,
    options: items.map((d) => ({ value: d.id, label: `${d.name}（${d.sn}）` })),
    isFetching: query.isFetching,
  };
}

export function useIotGroupOptions() {
  const query = useAllIotGroups();
  const items = query.data ?? [];
  return {
    items,
    options: items.map((g) => ({ value: g.id, label: g.name })),
    isFetching: query.isFetching,
  };
}

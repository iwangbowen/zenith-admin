import type { Region } from '@zenith/shared/platform';
import provincesJson from 'china-division/dist/provinces.json';
import citiesJson from 'china-division/dist/cities.json';
import areasJson from 'china-division/dist/areas.json';
import { mockDateTime } from '@/mocks/utils/date';

interface ProvinceItem { code: string; name: string }
interface CityItem { code: string; name: string; provinceCode: string }
interface AreaItem { code: string; name: string; cityCode: string; provinceCode: string }

const now = mockDateTime();

function makeRegion(
  code: string,
  name: string,
  level: 'province' | 'city' | 'county',
  parentCode: string | null,
  sort: number,
): Region {
  return {
    id: 0, // 在 handler 里按索引赋值
    code,
    name,
    level,
    parentCode,
    sort,
    status: 'enabled',
    createdAt: now,
    updatedAt: now,
  };
}

// 构建扁平列表
const provinceList: Region[] = (provincesJson as ProvinceItem[]).map((p, i) =>
  makeRegion(p.code, p.name, 'province', null, i),
);

const cityList: Region[] = (citiesJson as CityItem[]).map((c, i) =>
  makeRegion(c.code, c.name, 'city', c.provinceCode, i),
);

const areaList: Region[] = (areasJson as AreaItem[]).map((a, i) =>
  makeRegion(a.code, a.name, 'county', a.cityCode, i),
);

// 分配 id（从 1 开始）
let idCursor = 1;
[...provinceList, ...cityList, ...areaList].forEach((r) => {
  r.id = idCursor++;
});

export const mockRegions: Region[] = [...provinceList, ...cityList, ...areaList];

let nextRegionId = idCursor;
export function getNextRegionId(): number {
  return nextRegionId++;
}

const PI = Math.PI;
const A = 6378245.0; // 长半轴
const EE = 0.006693421622965943; // 偏心率平方

function outOfChina(lng: number, lat: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(lng: number, lat: number) {
  let r = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  r += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  r += (20 * Math.sin(lat * PI) + 40 * Math.sin(lat / 3 * PI)) * 2 / 3;
  r += (160 * Math.sin(lat / 12 * PI) + 320 * Math.sin(lat * PI / 30)) * 2 / 3;
  return r;
}
function transformLng(lng: number, lat: number) {
  let r = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  r += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  r += (20 * Math.sin(lng * PI) + 40 * Math.sin(lng / 3 * PI)) * 2 / 3;
  r += (150 * Math.sin(lng / 12 * PI) + 300 * Math.sin(lng / 30 * PI)) * 2 / 3;
  return r;
}
export function wgs2gcj(lng: number, lat: number) {
  if (outOfChina(lng, lat)) return { lng, lat };
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lng: lng + dLng, lat: lat + dLat };
}
export function gcj2wgs(lng: number, lat: number) {
  const g = wgs2gcj(lng, lat);
  return { lng: lng * 2 - g.lng, lat: lat * 2 - g.lat };
}
export function gcj2bd09(lng: number, lat: number) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * PI);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}
export function bd092gcj(lng: number, lat: number) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}
export function wgs2bd09(lng: number, lat: number) {
  const g = wgs2gcj(lng, lat);
  return gcj2bd09(g.lng, g.lat);
}
export function bd092wgs(lng: number, lat: number) {
  const g = bd092gcj(lng, lat);
  return gcj2wgs(g.lng, g.lat);
}

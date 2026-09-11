interface TiandituNS {
  Map: any;
  LngLat: any;
  Geocoder: any;
  MapType?: any;
  TileLayer?: any;
  [k: string]: any;
}

interface Window {
  T?: TiandituNS;
  AMap?: any;
  qq?: { maps: any };
  BMap?: any;
}

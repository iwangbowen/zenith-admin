declare module 'ip-range-check' {
  function ipRangeCheck(ip: string, range: string | string[]): boolean;
  export = ipRangeCheck;
}

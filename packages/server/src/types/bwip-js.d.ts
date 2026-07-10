declare module 'bwip-js' {
  const bwipjs: {
    toBuffer(options: Record<string, unknown>): Promise<Buffer>;
  };
  export default bwipjs;
}

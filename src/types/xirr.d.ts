declare module 'xirr' {
  interface XirrFlow {
    amount: number;
    when: Date;
  }
  function xirr(flows: XirrFlow[], opts?: { guess?: number }): number;
  export default xirr;
}

import { HTTPException } from 'hono/http-exception';
import type { PaymentOrderRow } from '../../db/schema';
import logger from '../logger';
import type {
  AdapterContext,
  ContractDeductInput,
  ContractDeductResult,
  ContractQueryInput,
  ContractQueryResult,
  ContractSignInput,
  ContractSignResult,
  PaymentChannelAdapter,
  PreauthCaptureInput,
  PreauthCaptureResult,
  PreauthFreezeInput,
  PreauthFreezeResult,
  PreauthQueryInput,
  PreauthQueryResult,
  ProfitShareReverseInput,
  ProfitShareReverseQueryResult,
  ProfitShareReverseResult,
} from './types';
import { buildSignedSandboxOperation } from './sandbox-operation';

export function requireSandboxOperation(ctx: AdapterContext, operation: string, providerLabel: string): void {
  if (!ctx.config.sandbox) {
    throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${providerLabel}/${operation}/live` });
  }
}

export interface SandboxContractPreauthOptions {
  /** `requireSandboxOperation` 的渠道标签（`alipay` / `wechat`） */
  label: string;
  /** 日志前缀（`[alipay]` / `[wechat-pay]`） */
  logPrefix: string;
  /** 沙箱参考号前缀 */
  refs: { contract: string; preauth: string; preauthCapture: string; deduct: string };
  /** 沙箱扣款流水号的随机后缀（各渠道沿用原有生成方式） */
  deductSuffix: () => string;
  /** 非沙箱渠道尚不支持时的提示（真实模式需商户开通对应产品权限） */
  liveMessages: {
    sign: string;
    terminate: string;
    deduct: string;
    preauthFreeze: string;
    preauthCapture: string;
    preauthRelease: string;
  };
}

type SandboxContractPreauthOps = Required<Pick<PaymentChannelAdapter,
  'signContract' | 'terminateContract' | 'queryContract' | 'deductContract'
  | 'preauthFreeze' | 'preauthCapture' | 'preauthRelease' | 'queryPreauth'>>;

/**
 * 签约代扣 + 资金预授权的沙箱模拟实现（支付宝 / 微信共用）：
 * 签约 / 冻结 / 转支付即时成功并返回带签名的沙箱参考号，查询按 operation 收敛终态，非沙箱抛不支持。
 */
export function sandboxContractPreauthOps(options: SandboxContractPreauthOptions): SandboxContractPreauthOps {
  const { label, logPrefix, refs, deductSuffix, liveMessages } = options;
  return {
    async signContract(ctx: AdapterContext, input: ContractSignInput): Promise<ContractSignResult> {
      if (ctx.config.sandbox) {
        logger.info(`${logPrefix} simulate contract sign (sandbox)`, { outContractNo: input.outContractNo, plan: input.planName });
        const signed = buildSignedSandboxOperation(ctx, refs.contract, 'contract.sign', { outContractNo: input.outContractNo });
        await Promise.resolve();
        return { channelContractNo: signed.reference, status: 'signed', raw: signed.raw };
      }
      throw new HTTPException(400, { message: liveMessages.sign });
    },

    async terminateContract(ctx: AdapterContext, input): Promise<void> {
      if (ctx.config.sandbox) {
        logger.info(`${logPrefix} simulate contract terminate (sandbox)`, { outContractNo: input.outContractNo });
        await Promise.resolve();
        return;
      }
      throw new HTTPException(400, { message: liveMessages.terminate });
    },

    async queryContract(ctx: AdapterContext, input: ContractQueryInput): Promise<ContractQueryResult> {
      requireSandboxOperation(ctx, 'contract.query', label);
      const signed = buildSignedSandboxOperation(ctx, refs.contract, 'contract.sign', { outContractNo: input.outContractNo });
      await Promise.resolve();
      return {
        status: input.operation === 'terminate' ? 'terminated' : 'signed',
        channelContractNo: input.channelContractNo ?? signed.reference,
        raw: signed.raw,
      };
    },

    async deductContract(ctx: AdapterContext, input: ContractDeductInput): Promise<ContractDeductResult> {
      if (ctx.config.sandbox) {
        logger.info(`${logPrefix} simulate contract deduct (sandbox)`, { outTradeNo: input.outTradeNo, amount: input.amount });
        await Promise.resolve();
        return { channelTradeNo: `${refs.deduct}${Date.now()}${deductSuffix()}`, status: 'success' };
      }
      throw new HTTPException(400, { message: liveMessages.deduct });
    },

    async preauthFreeze(ctx: AdapterContext, input: PreauthFreezeInput): Promise<PreauthFreezeResult> {
      if (ctx.config.sandbox) {
        logger.info(`${logPrefix} simulate preauth freeze (sandbox)`, { outPreauthNo: input.outPreauthNo, amount: input.amount });
        const signed = buildSignedSandboxOperation(ctx, refs.preauth, 'preauth.freeze', { outPreauthNo: input.outPreauthNo });
        await Promise.resolve();
        return { channelPreauthNo: signed.reference, status: 'frozen', raw: signed.raw };
      }
      throw new HTTPException(400, { message: liveMessages.preauthFreeze });
    },

    async preauthCapture(ctx: AdapterContext, input: PreauthCaptureInput): Promise<PreauthCaptureResult> {
      if (ctx.config.sandbox) {
        logger.info(`${logPrefix} simulate preauth capture (sandbox)`, { outPreauthNo: input.outPreauthNo, captureAmount: input.captureAmount });
        const signed = buildSignedSandboxOperation(ctx, refs.preauthCapture, 'preauth.capture', { outPreauthNo: input.outPreauthNo, outTradeNo: input.outTradeNo });
        await Promise.resolve();
        return { channelTradeNo: signed.reference, status: 'success', raw: signed.raw };
      }
      throw new HTTPException(400, { message: liveMessages.preauthCapture });
    },

    async preauthRelease(ctx: AdapterContext, input): Promise<void> {
      if (ctx.config.sandbox) {
        logger.info(`${logPrefix} simulate preauth release (sandbox)`, { outPreauthNo: input.outPreauthNo });
        await Promise.resolve();
        return;
      }
      throw new HTTPException(400, { message: liveMessages.preauthRelease });
    },

    async queryPreauth(ctx: AdapterContext, input: PreauthQueryInput): Promise<PreauthQueryResult> {
      requireSandboxOperation(ctx, 'preauth.query', label);
      if (input.operation === 'capture') {
        const signed = buildSignedSandboxOperation(ctx, refs.preauthCapture, 'preauth.capture', { outPreauthNo: input.outPreauthNo, outTradeNo: input.outTradeNo });
        return { status: 'captured', channelPreauthNo: input.channelPreauthNo, channelTradeNo: signed.reference, raw: signed.raw };
      }
      const signed = buildSignedSandboxOperation(ctx, refs.preauth, 'preauth.freeze', { outPreauthNo: input.outPreauthNo });
      return {
        status: input.operation === 'release' ? 'released' : 'frozen',
        channelPreauthNo: input.channelPreauthNo ?? signed.reference,
        raw: signed.raw,
      };
    },
  };
}

export async function sandboxProfitShareReverse(
  ctx: AdapterContext,
  order: PaymentOrderRow,
  input: ProfitShareReverseInput,
  options: { prefix: string; label: string; query?: false },
): Promise<ProfitShareReverseResult>;
export async function sandboxProfitShareReverse(
  ctx: AdapterContext,
  order: PaymentOrderRow,
  input: ProfitShareReverseInput,
  options: { prefix: string; label: string; query: true },
): Promise<ProfitShareReverseQueryResult>;
export async function sandboxProfitShareReverse(
  ctx: AdapterContext,
  order: PaymentOrderRow,
  input: ProfitShareReverseInput,
  options: { prefix: string; label: string; query?: boolean },
): Promise<ProfitShareReverseResult | ProfitShareReverseQueryResult> {
  requireSandboxOperation(ctx, 'profit-sharing.reverse', options.label);
  const signed = buildSignedSandboxOperation(ctx, options.prefix, 'profit-sharing.reverse', {
    orderNo: order.orderNo,
    outSharingNo: input.outSharingNo,
    channelSharingNo: input.channelSharingNo,
    outReversalNo: input.outReversalNo,
    amount: input.amount,
    reason: input.reason,
  });
  await Promise.resolve();
  return options.query
    ? { channelReversalNo: signed.reference, status: 'success', finishedAt: new Date(), raw: signed.raw }
    : { channelReversalNo: signed.reference, status: 'success', raw: signed.raw };
}

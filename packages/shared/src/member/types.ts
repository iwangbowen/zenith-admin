/**
 * 会员域中无法由契约 schema 推导的类型。
 * 会员 / 等级 / 积分 / 钱包 / 优惠券 / 签到等 API 实体类型一律从 `./contracts` 推导。
 */

/** 自签名证书生成参数（运维 SSL 证书服务的入参） */
export interface GenerateSelfSignedCertInput {
  name: string;
  domain: string;
  days?: number;
  country?: string;
  organization?: string;
  outputDir?: string;
}

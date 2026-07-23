export function cmsStaticTargetKey(channelCode: string, phase: number, id: number): string {
  return `${channelCode}|${phase}|${String(id).padStart(12, '0')}`;
}

export function isCmsStaticTargetCompleted(targetKey: string, resumeAfterKey: string | null | undefined): boolean {
  return Boolean(resumeAfterKey && targetKey <= resumeAfterKey);
}

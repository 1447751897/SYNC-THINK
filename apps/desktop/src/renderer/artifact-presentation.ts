const GROUP_FINAL_STEP_TITLE = '主智能体检查并总结结果';
const GENERIC_OUTPUT = /^Step output\b/i;
const REVIEW_OUTPUT = /^Review outcome\b/i;
const INTERNAL_OUTPUT = /^(?:Skipped group member|Tool trace)\b/i;

export interface ArtifactPresentationCandidate {
  name: string;
  stepTitle?: string;
  selected?: boolean;
  merged?: boolean;
  hasConflict?: boolean;
}

export function isUserFacingArtifact(candidate: ArtifactPresentationCandidate): boolean {
  if (candidate.selected || candidate.merged || candidate.hasConflict) return true;
  if (INTERNAL_OUTPUT.test(candidate.name) || REVIEW_OUTPUT.test(candidate.name)) return false;
  if (GENERIC_OUTPUT.test(candidate.name)) {
    return candidate.stepTitle === GROUP_FINAL_STEP_TITLE;
  }
  return true;
}

export function artifactDisplayName(candidate: ArtifactPresentationCandidate): string {
  if (GENERIC_OUTPUT.test(candidate.name) && candidate.stepTitle === GROUP_FINAL_STEP_TITLE) {
    return '最终结果';
  }
  if (REVIEW_OUTPUT.test(candidate.name) && (candidate.selected || candidate.merged)) {
    return '审核通过的结果';
  }
  return candidate.name;
}

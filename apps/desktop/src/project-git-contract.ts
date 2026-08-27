export interface ProjectGitChange {
  status: string;
  path: string;
}

export interface ProjectGitRecentCommit {
  hash: string;
  subject: string;
  files: ProjectGitChange[];
  truncated: boolean;
}

export interface ProjectGitInfo {
  branch: string | null;
  branches: string[];
  changes: ProjectGitChange[];
  recentCommits: ProjectGitRecentCommit[];
  additions: number;
  deletions: number;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  isRepo: boolean;
}

export interface ProjectGitReviewFile {
  path: string;
  action: 'created' | 'edited' | 'deleted';
  previousContent?: string;
  content?: string;
  previousTruncated?: boolean;
}

export interface ProjectGitReview {
  files: ProjectGitReviewFile[];
}

export interface ProjectGitCheckoutResult {
  ok: boolean;
  dirty: boolean;
  changes: ProjectGitChange[];
  error: string | null;
  stashed?: boolean;
}

export interface ProjectGitActionResult {
  ok: boolean;
  error: string | null;
}

export interface ProjectGitCommitResult extends ProjectGitActionResult {
  committed: boolean;
  pushed: boolean;
}

export interface ProjectGitPushResult extends ProjectGitActionResult {
  pushed: boolean;
}

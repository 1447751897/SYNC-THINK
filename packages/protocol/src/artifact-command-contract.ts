import type {
  CompareArtifactVersionsPayload,
  CompareArtifactVersionsResponse,
  GetArtifactVersionPayload,
  GetArtifactVersionResponse,
  ListArtifactMergeConflictsPayload,
  ListArtifactMergeConflictsResponse,
  ListArtifactsPayload,
  ListArtifactsResponse,
  MergeArtifactVersionsPayload,
  MergeArtifactVersionsResponse,
  ResolveArtifactMergeConflictPayload,
  ResolveArtifactMergeConflictResponse,
  SelectArtifactVersionPayload,
  SelectArtifactVersionResponse,
} from './commands.js';

/** Versioned artifact query, selection, merge and conflict-resolution RPCs. */
export interface ArtifactCommandContract {
  'artifact.list': { request: ListArtifactsPayload; response: ListArtifactsResponse };
  'artifact.getVersion': {
    request: GetArtifactVersionPayload;
    response: GetArtifactVersionResponse;
  };
  'artifact.compare': {
    request: CompareArtifactVersionsPayload;
    response: CompareArtifactVersionsResponse;
  };
  'artifact.selectVersion': {
    request: SelectArtifactVersionPayload;
    response: SelectArtifactVersionResponse;
  };
  'artifact.merge': {
    request: MergeArtifactVersionsPayload;
    response: MergeArtifactVersionsResponse;
  };
  'artifact.listConflicts': {
    request: ListArtifactMergeConflictsPayload;
    response: ListArtifactMergeConflictsResponse;
  };
  'artifact.resolveConflict': {
    request: ResolveArtifactMergeConflictPayload;
    response: ResolveArtifactMergeConflictResponse;
  };
}

export type ArtifactCommand = keyof ArtifactCommandContract;
export type ArtifactCommandRequest<K extends ArtifactCommand> =
  ArtifactCommandContract[K]['request'];
export type ArtifactCommandResponse<K extends ArtifactCommand> =
  ArtifactCommandContract[K]['response'];

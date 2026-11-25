export type RefState = 'NONE' | 'OK' | 'BROKEN' | 'UNREADABLE';
export type Rule = {
  id?: string; role: string; enabled: boolean; strictSubRoles: boolean;
  writers: 'ALL' | 'ADMIN' | 'OWNER'; validateBy: 'AGENT' | 'PLATFORM' | null;
  authorTask: string | null; authorTaskId: string | null; authorTaskState: RefState;
  validationTask: string | null; validationTaskId: string | null; validationTaskState: RefState;
  descriptionNode: string | null; descriptionNodeId: string | null; descriptionNodeState: RefState;
  revision?: number; locked?: boolean;
  sourceTemplate?: { id: string; name: string; deleted: boolean } | null;
};
/** An org-default rule skipped when the memory was created (hadron-server#3426). `ref` and `refState` are the template rule's reference as the calling manager sees it now. */
export type DefaultSkip = { role: string; field: 'authorTask' | 'validationTask' | 'descriptionNode'; reason: string; ref: string | null; refState: RefState; sourceTemplate: { id: string; name: string; deleted: boolean } | null; createdAt: string };
export type Rulebook = { id?: string | null; rules: Rule[]; defaultSkips?: DefaultSkip[] };
export type Template = { id: string; name: string; description: string | null; required: boolean; /** Organization-owned templates only; absent reads as off. */ orgDefault?: boolean; revision: number; rules: Rule[] };
export type OwnerType = 'USER' | 'ORGANIZATION' | 'APP';
/** An advisory the server attached to a save or apply (hadron-server#3502). Never a failure. */
export type MemoryConfigWarning = { code: string; role: string; field: string | null; taskUrn: string | null; taskState: string | null };
export type ApplyPreview = { memoryId: string; templateRevision: number; required: boolean; dryRun: boolean; entries: { role: string; outcome: 'APPLIED' | 'SKIPPED_CONFLICT' | 'REPLACED' | 'SKIPPED_LOCKED' }[]; warnings: MemoryConfigWarning[] };

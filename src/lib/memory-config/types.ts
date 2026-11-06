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
export type Rulebook = { id?: string | null; rules: Rule[] };
export type Template = { id: string; name: string; description: string | null; required: boolean; revision: number; rules: Rule[] };
export type OwnerType = 'USER' | 'ORGANIZATION' | 'APP';
export type ApplyPreview = { memoryId: string; templateRevision: number; required: boolean; dryRun: boolean; entries: { role: string; outcome: 'APPLIED' | 'SKIPPED_CONFLICT' | 'REPLACED' | 'SKIPPED_LOCKED' }[]; warnings: { code: string; role: string; field: string | null }[] };

/** portal#1666: viewer-safe transport models. Source identities never cross this boundary unless independently readable. */
export type CompileOwner = { level: 'app'; app: string; agent: string } | { level: 'worker'; worker: string; app: string; agent: string };
export const compileOwnerKey = (owner: CompileOwner) => owner.level === 'app' ? `appCompile:${owner.app}:${owner.agent}` : `workerCompile:${owner.worker}:${owner.app}:${owner.agent}`;
export type Serve = { served: { compiledNodeId: string; servedRevSeq: number; pointerLevel: 'AGENT' | 'APP_AGENT' | 'WORKER' } | null; refusal: string | null } | null;
export function servedNowText(value: Serve, owner: CompileOwner, nodeId: string): string {
  if (!value) return 'Couldn’t read what would be served now.';
  if (value.refusal) {
    const reasons: Record<string, string> = { BOOT_PROMPT_NOT_APPROVED: 'no approved revision is available', BOOT_PROMPT_NOT_SET: 'no prompt is set', BOOT_PROMPT_TARGET_DELETED: 'the prompt it points at was removed', BOOT_PROMPT_NOT_SIGNED: 'no signed revision is available' };
    return reasons[value.refusal] ? `Right now it would be refused: ${reasons[value.refusal]}.` : 'Couldn’t read what would be served now.';
  }
  if (!value.served) return 'Couldn’t read what would be served now.';
  const s = value.served;
  const prompt = s.compiledNodeId === nodeId ? 'this prompt' : ({ AGENT: 'the Agent’s prompt', APP_AGENT: 'the App’s prompt', WORKER: 'the worker’s own prompt' })[s.pointerLevel];
  return `${owner.level === 'worker' ? 'This worker’s next bind' : 'A worker without its own prompt, a chat or a run started now'} would get revision ${s.servedRevSeq} of ${prompt}.`;
}
export type ProvenanceRow = { name: string | null; urn: string | null; omitted: boolean; depth: number; revNo: number; selection: { rev: number | null; approved: boolean; signed: boolean }; pruned: boolean | null };
export type ProvenancePage = { items: ProvenanceRow[]; total: number; hasMore: boolean; pruned: boolean; offset: number };
export type InstallCompiled = { id: string; urn: string; revision: number; content: string; pending: boolean; lint: { items: { kind: string; position: number; text: string }[]; total: number } | null };
export type InstallCompileView = { key: string; compiled: InstallCompiled | null; source: { id: string; urn: string; name: string; memoryId: string } | null; canStart: boolean; pointerMatches: boolean | null };

import { t } from '$lib/i18n/t';
import type { GraphQLClient } from 'graphql-request';
import { compileOwnerKey, servedNowText, type CompileOwner, type InstallCompileView, type ProvenancePage, type Serve } from '$lib/boot-install';
import { compileRefusalStatus, compileRefusalText } from '$lib/boot-compile';
import { approvalRefusalStatus, approveRefusalText } from '$lib/node-approval';
import { customisationRefusalLead } from '$lib/install-customisation';
import { extractGqlErrorCode, extractGqlErrorExtensions } from './gqlError';
import { APPROVE_NODE_MUTATION, CREATE_NODE_MUTATION, INSTALL_MEMORY_QUERY } from './queries';
import { readCompiled } from './boot-source';
type Client = Pick<GraphQLClient, 'request'>;
export const INSTALL_COMPILE = /* GraphQL */ `mutation CompileAppInstall($appRef: String!, $agentRef: String!) { compileAppAgentBootPrompt(appRef: $appRef, agentRef: $agentRef) { revNo node { id urn revision approvalStatus { state } } } }`;
export const WORKER_COMPILE = /* GraphQL */ `mutation CompileWorkerInstall($workerRef: ID!, $setPointer: Boolean!) { compileWorkerBootPrompt(workerRef: $workerRef, setPointer: $setPointer) { revNo node { id urn revision approvalStatus { state } } } }`;
const SOURCE_NODE = /* GraphQL */ `query InstallBootNode($ref: ID!, $memoryRef: ID!) { node(ref: $ref, memoryRef: $memoryRef) { id urn name } }`;
const WORKER = /* GraphQL */ `query CompileWorkerIdentity($ref: ID!) { worker(ref: $ref) { id app { id } agent { id } bootPromptRef } }`;
const APP = /* GraphQL */ `query CompileInstallIdentity($ref: ID!) { app(ref: $ref) { id appAgents { agent { id } bootPromptRef } } }`;
const WORKER_SERVE = /* GraphQL */ `query CompileWorkerServe($ref: ID!) { worker(ref: $ref) { bootPromptServe { refusal served { compiledNodeId servedRevSeq pointerLevel } } } }`;
const APP_SERVE = /* GraphQL */ `query CompileAppServe($ref: ID!) { app(ref: $ref) { appAgents { agent { id } bootPromptServe { refusal served { compiledNodeId servedRevSeq pointerLevel } } } } }`;
export async function installIdentity(client: Client, owner: CompileOwner): Promise<{ pointer: string | null }> {
  if (owner.level === 'worker') {
    const { worker } = await client.request<{ worker: { id: string; app: { id: string } | null; agent: { id: string } | null; bootPromptRef: string | null } | null }>(WORKER, { ref: owner.worker });
    if (!worker || worker.id !== owner.worker || worker.app?.id !== owner.app || worker.agent?.id !== owner.agent) throw new Error('identity');
    return { pointer: worker.bootPromptRef };
  }
  const { app } = await client.request<{ app: { id: string; appAgents: { agent: { id: string } | null; bootPromptRef: string | null }[] } | null }>(APP, { ref: owner.app });
  const row = app?.appAgents.find(r => r.agent?.id === owner.agent);
  if (!app || app.id !== owner.app || !row) throw new Error('identity');
  return { pointer: row.bootPromptRef };
}
async function serve(client: Client, owner: CompileOwner): Promise<Serve> {
  try {
    if (owner.level === 'worker') return (await client.request<{ worker: { bootPromptServe: Serve } | null }>(WORKER_SERVE, { ref: owner.worker })).worker?.bootPromptServe ?? null;
    const r = await client.request<{ app: { appAgents: { agent: { id: string } | null; bootPromptServe: Serve }[] } | null }>(APP_SERVE, { ref: owner.app });
    return r.app?.appAgents.find(r => r.agent?.id === owner.agent)?.bootPromptServe ?? null;
  } catch { return null; }
}
export async function readInstallPrompt(client: Client, owner: CompileOwner): Promise<InstallCompileView> {
  const key = compileOwnerKey(owner);
  const { pointer } = await installIdentity(client, owner);
  let source: InstallCompileView['source'] = null;
  let canStart = false;
  if (owner.level === 'worker') {
    try {
      const { installMemory } = await client.request<{ installMemory: { id: string } | null }>(INSTALL_MEMORY_QUERY, { appRef: owner.app, agentRef: owner.agent });
      if (!installMemory) canStart = true;
      else {
        const r = await client.request<{ node: { id: string; urn: string; name?: string } | null }>(SOURCE_NODE, { ref: `boot:workers:${owner.worker}:source`, memoryRef: installMemory.id });
        source = r.node ? { ...r.node, name: r.node.name ?? t('boot.install.18cd2eb10c', 'Worker boot prompt source'), memoryId: installMemory.id } : null;
        canStart = !r.node;
      }
    } catch { canStart = false; }
  }
  // The compiled loc is fixed, including when worker setPointer:false keeps a different pointer.
  let compiled = null;
  let compiledReadFailed = false;
  try {
    const { installMemory } = await client.request<{ installMemory: { id: string; urn: string } | null }>(INSTALL_MEMORY_QUERY, { appRef: owner.app, agentRef: owner.agent });
    if (installMemory) {
      const loc = owner.level === 'worker' ? `boot:workers:${owner.worker}:compiled` : 'boot:compiled';
      const r = await client.request<{ node: { id: string } | null }>(SOURCE_NODE, { ref: loc, memoryRef: installMemory.id });
      if (r.node) {
        compiled = await readCompiled(client, r.node.id);
        compiledReadFailed = compiled === null;
      }
    }
  } catch { compiledReadFailed = true; }
  return { key, source, canStart, compiled, compiledReadFailed, pointerMatches: compiled ? pointer === compiled.id || pointer === compiled.urn : null };
}
export type InstallIntent = { intent: 'compile' | 'approve' | 'start'; nodeId?: string; revision?: number };
export async function writeInstallPrompt(client: Client, owner: CompileOwner, input: InstallIntent, impersonating: boolean) {
  const refused = (text: string, status = 403) => ({ ok: false, text, status, key: compileOwnerKey(owner) });
  if (impersonating) return refused(t('boot.install.56e8d83035', 'This prompt can’t be updated while impersonating. Sign in as yourself.'));
  try { await installIdentity(client, owner); } catch { return refused(t('boot.install.0ecdfc6a12', 'This worker’s Agent or App changed, or the installation is unavailable. Reload before trying again.'), 409); }
  if (input.intent === 'start') {
    if (owner.level !== 'worker') return refused(t('boot.install.worker-required', 'A worker is required.'), 400);
    try {
      await client.request(CREATE_NODE_MUTATION, { input: { install: { appRef: owner.app, agentRef: owner.agent }, loc: `boot:workers:${owner.worker}:source`, name: t('boot.install.18cd2eb10c', 'Worker boot prompt source'), role: 'boot-prompt', content: '' } });
      return { ok: true, key: compileOwnerKey(owner), text: t('boot.install.db31e98029', 'An empty source was started. Nothing served changed.') };
    } catch (e) {
      const code = extractGqlErrorCode(e);
      return refused(code === 'NodeLocConflictError' ? t('boot.install.227d62de11', 'This worker already has a source. Reload to open it.') : customisationRefusalLead(code) ?? t('boot.install.a06a518a01', 'Could not confirm the source was started. Reload to check before trying again.'), code === 'NodeLocConflictError' ? 409 : customisationRefusalLead(code) ? 403 : 502);
    }
  }
  if (input.intent === 'approve') {
    // A forged node/revision must belong to this owner, not merely be approvable elsewhere.
    const notSent = () => refused(t('boot.install.approve-read-failed', 'Couldn’t read this prompt for approval. No approval request was sent. Reload before trying again.'), 502);
    let view: InstallCompileView;
    try { view = await readInstallPrompt(client, owner); } catch { return notSent(); }
    if (view.compiledReadFailed) return notSent();
    if (!view.compiled || view.compiled.id !== input.nodeId || view.compiled.revision !== input.revision) return refused(t('boot.install.2fc00c74cf', 'This prompt changed. Reload and review the current revision before approving it.'), 409);
    try {
      await client.request(APPROVE_NODE_MUTATION, { nodeRef: input.nodeId, revision: input.revision });
    } catch (e) {
      const code = extractGqlErrorCode(e);
      const status = approvalRefusalStatus(code);
      return refused(status === 500 ? t('boot.install.58bfd955cf', 'Couldn’t confirm the approval. Reload to check before trying again.') : code === 'BOOT_PROMPT_APPROVAL_FORBIDDEN' ? t('boot.install.e0d5c4e475', 'Only whoever manages this App, signed in as themselves, can approve this boot prompt.') : approveRefusalText(code), status);
    }
    return { ok: true, key: compileOwnerKey(owner), text: `${t('boot.install.approved', 'Revision {n} approved. Sessions already open keep the revision they were bound with.', { n: input.revision! })} ${servedNowText(await serve(client, owner), owner, input.nodeId!)}${owner.level === 'worker' ? ` ${t('boot.install.pointer-unchanged', 'The worker’s pointer wasn’t changed.')}` + (view.pointerMatches === false ? ` ${t('boot.install.not-pointed', 'This worker isn’t pointed at it yet.')}` : '') : ''}` };
  }
  let result: { node: { id: string; urn?: string; revision?: number; approvalStatus?: { state: string } | null }; revNo: number };
  try {
    if (owner.level === 'worker') result = (await client.request<{ compileWorkerBootPrompt: typeof result }>(WORKER_COMPILE, { workerRef: owner.worker, setPointer: false })).compileWorkerBootPrompt;
    else result = (await client.request<{ compileAppAgentBootPrompt: typeof result }>(INSTALL_COMPILE, { appRef: owner.app, agentRef: owner.agent })).compileAppAgentBootPrompt;
    if (!result?.node?.id || !Number.isInteger(result.revNo)) throw new Error('unknown outcome');
  } catch (e) {
    const code = extractGqlErrorCode(e);
    const text = compileRefusalText(code, extractGqlErrorExtensions(e)?.position, undefined, owner.level === 'app' ? 'App' : 'worker');
    const status = compileRefusalStatus(code);
    const state = status !== 500 && code !== 'CONFLICT' ? await serve(client, owner) : null;
    return refused(state ? `${text} ${servedNowText(state, owner, '')}` : text, status);
  }
  const state = await serve(client, owner);
  let pointer = '';
  if (owner.level === 'worker') {
    pointer = ` ${t('boot.install.pointer-unchanged', 'The worker’s pointer wasn’t changed.')}`;
    try { const current = await installIdentity(client, owner); if (current.pointer !== result.node.id && current.pointer !== result.node.urn) pointer += ` ${t('boot.install.not-pointed', 'This worker isn’t pointed at it yet.')}`; } catch { /* no inference on failed read */ }
  }
  // Approval describes the returned compiled revision, never the independently read serve target.
  // A concurrent newer revision or unavailable state must not be called unapproved.
  const approvalState = result.node.revision === result.revNo ? result.node.approvalStatus?.state : null;
  const approvalText = approvalState === 'APPROVED'
    ? t('boot.install.retained-approval', 'Its existing approval still applies.')
    : approvalState === 'NOT_APPROVED' || approvalState === 'SUPERSEDED'
      ? t('boot.install.not-approved', 'It isn’t approved yet.')
      : t('boot.install.approval-state-unknown', 'Couldn’t confirm its approval state. Reload to check.');
  return { ok: true, key: compileOwnerKey(owner), text: `${t('boot.install.built-revision', 'Built revision {n}.', { n: result.revNo })} ${approvalText} ${t('boot.install.compile-no-approval', 'Compiling didn’t approve or sign it.')} ${servedNowText(state, owner, result.node.id)}${pointer}` };
}
export const PROVENANCE = /* GraphQL */ `query CompileProvenance($nodeRef: ID!, $revNo: Int!, $offset: Int!) { compiledPromptProvenance(nodeRef: $nodeRef, revNo: $revNo, offset: $offset, limit: 20) { items { nodeId depth revNo selection { rev approved signed } pruned } total hasMore pruned } }`;
const NAMES = /* GraphQL */ `query CompileProvenanceNames($refs: [ID!]!) { nodeBatch(refs: $refs) { nodes { id urn name } unavailable omitted } }`;
export async function readProvenance(client: Client, nodeRef: string, revNo: number, offset: number): Promise<ProvenancePage | null> {
  type Occurrence = { nodeId: string; depth: number; revNo: number; selection: { rev: number | null; approved: boolean; signed: boolean }; pruned: boolean | null };
  const { compiledPromptProvenance: page } = await client.request<{ compiledPromptProvenance: { items: Occurrence[]; total: number; hasMore: boolean; pruned: boolean } | null }>(PROVENANCE, { nodeRef, revNo, offset });
  if (!page) return null;
  if (page.items.length === 0) return { items: [], total: page.total, hasMore: page.hasMore, pruned: page.pruned, offset };
  const { nodeBatch } = await client.request<{ nodeBatch: { nodes: { id: string; urn: string; name: string }[]; omitted: string[]; unavailable: string[] } }>(NAMES, { refs: [...new Set(page.items.map(i => i.nodeId))] });
  return { total: page.total, hasMore: page.hasMore, pruned: page.pruned, offset, items: page.items.map(({ nodeId, ...i }) => {
    const node = nodeBatch.nodes.find(n => n.id === nodeId);
    return { ...i, name: node?.name ?? null, urn: node?.urn ?? null, omitted: nodeBatch.omitted.includes(nodeId), pruned: node ? i.pruned : null };
  }) };
}

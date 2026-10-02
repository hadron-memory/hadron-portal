import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { MINT_MEMORY_NODES_MUTATION } from '$lib/server/queries';
import { mintBlockedUnlistedText, mintFailure, type MintFinding, type MintReport } from '$lib/node-mint';
import type { RequestHandler } from './$types';

// #992 slice C: "Mint nodes" from the memory actions menu, posted to like
// /approve-all. `dryRun: true` (the default here) is the check the dialog runs
// first; the real run is only offered when nothing blocks.
//
// A refused real run (SPEC_CORPUS_MINT_BLOCKED) means something changed since
// the dry run, so the endpoint answers with a fresh dry-run report beside the
// refusal: the dialog shows what blocks NOW, not the stale list.

interface ServerReport {
  dryRun: boolean;
  minted: boolean;
  mintedCount: number;
  mintLocs: string[];
  blockers: MintFinding[];
  openQuestions: Array<{ questions: unknown[] }>;
}

function toReport(r: ServerReport): MintReport {
  return {
    dryRun: r.dryRun,
    minted: r.minted,
    mintedCount: r.mintedCount,
    mintableCount: r.mintLocs.length,
    blockers: r.blockers.map(({ kind, loc, rule, targetLoc }) => ({ kind, loc, rule: rule ?? null, targetLoc: targetLoc ?? null })),
    openQuestionCount: r.openQuestions.reduce((n, g) => n + g.questions.length, 0),
  };
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  // Anything but an explicit `false` is a dry run: a malformed body never mints.
  const dryRun = body?.dryRun !== false;
  const client = gqlClient(locals.token);
  const run = (dry: boolean) =>
    client.request<{ mintMemoryNodes: ServerReport }>(MINT_MEMORY_NODES_MUTATION, { memoryRef: params.id, dryRun: dry });
  try {
    const res = await run(dryRun);
    return json({ report: toReport(res.mintMemoryNodes) });
  } catch (e: unknown) {
    const code = extractGqlErrorCode(e);
    const { status, text } = mintFailure(code);
    if (code === 'SPEC_CORPUS_MINT_BLOCKED') {
      try {
        const fresh = await run(true);
        return json({ error: text, report: toReport(fresh.mintMemoryNodes) }, { status });
      } catch {
        // No fresh list to show, so the copy mustn't promise one (Gene on #996).
        return json({ error: mintBlockedUnlistedText() }, { status });
      }
    }
    if (status === 500) console.error('[memories/mint] failed:', e);
    return json({ error: text }, { status });
  }
};

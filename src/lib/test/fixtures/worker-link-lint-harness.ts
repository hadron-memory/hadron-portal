/** Real editor, synthetic GET and Kit stores: author layout only, no sign-in/provider/save claim. */
import { mount } from 'svelte';
import Section from '../../../routes/app/workers/[id]/WorkerSignatureSection.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
let calls = 0;
export const lintCalls = () => calls;
export function mountWorkerLinkLint(target: HTMLElement, variant: string) {
  calls = 0;
  setStubPage('https://example.test/app/workers/a?tab=briefing', { id: 'a' });
  const fields = variant === 'signature' ? ['signature'] : variant === 'trailer' ? ['trailer'] : ['signature', 'trailer'];
  const items = variant === 'zero' ? [] : variant === 'unknown' ? [{ kind: 'FUTURE', workerField: null }] : fields.map(workerField => ({ kind: 'WORKER_LINK_MISSING', workerField }));
  window.fetch = async () => { calls++; return Response.json({ workerId: 'a', page: variant === 'unavailable' ? null : { items, total: variant === 'partial' ? 3 : items.length, nextCursor: variant === 'partial' ? 'next' : null } }); };
  const signature = variant === 'masked' ? null : '— Engineering helper';
  const trailer = variant === 'masked' ? null : 'Worker: Engineering helper';
  const data = { _kind: 'updateSignature' as const, signature: signature ?? '', trailer: trailer ?? '', signatureBase: signature ?? '', trailerBase: trailer ?? '' };
  mount(Section, { target, props: { workerId: 'a', signature, trailer, retired: false, actionResult: undefined, initialForm: { id: 'updateSignature:a', valid: true, posted: false, errors: {}, data, constraints: {} } } });
}

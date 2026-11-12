import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadOrgSigningSwitch, loadSigningPreview, setOrgSigning } from '$lib/server/org-boot-prompt-signing';
import type { Actions, PageServerLoad } from './$types';

// portal#1921 (R1): the preview and the switch-on step of the org boot-prompt
// signing setting. The Profile tab owns the state and Switch off; this route
// owns "what would switching on change" and the switch-on itself (R4: the
// preview IS the confirmation, no modal).
//
// The server is the gate (cor:api:240:01). The org layout already 404s a
// non-member; a member below ADMIN (or an impersonated session) gets FORBIDDEN
// from the read, which is a 404 here too, so the route says nothing about the
// org's state. An outage is a value (`failed`), never a thrown 500.
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const sw = await loadOrgSigningSwitch(client, params.id);
  if (sw.kind === 'hidden') error(404, 'Not found');
  // R5: no preview from a required state, and none when the read failed.
  if (sw.kind === 'failed' || sw.required) return { sw, preview: null };
  const preview = await loadSigningPreview(client, params.id);
  if (preview.kind === 'hidden') error(404, 'Not found');
  return { sw, preview };
};

export const actions: Actions = {
  // The token comes from the preview the page rendered: a hidden input inside
  // that preview's own form. The portal cannot prove it was *shown*, only that
  // it came from a page that rendered the preview; the server binds the token
  // to org, caller, a digest of the full preview and ten minutes, and is the
  // real gate. `required` is stated here, never read from the form.
  switchOn: async ({ request, params, locals }) => {
    const token = String((await request.formData()).get('previewToken') ?? '').trim();
    if (!token) return fail(400, { outcome: 'no_review' as const });
    const client = gqlClient(locals.token);
    const r = await setOrgSigning(client, params.id, { required: true, previewToken: token });
    if (r.kind === 'ok') return { outcome: 'done' as const, signing: { required: r.required, enforced: r.enforced, deploymentSigns: r.deploymentSigns } };
    if (r.kind === 'hidden') return fail(403, { outcome: 'hidden' as const });
    if (r.kind === 'stale') {
      // The reloaded preview rides in the action result: invalidateAll() would
      // drop a failed action's form (findings:invalidateall-drops-failed-action-form).
      const preview = await loadSigningPreview(client, params.id);
      return fail(409, { outcome: 'stale' as const, preview });
    }
    return fail(500, { outcome: 'failed' as const });
  },
};

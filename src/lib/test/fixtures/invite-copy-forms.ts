// Clipboard harness only: invitation creation is deliberately not exercised.
// Drift diagnostics (#1742): the Invite page may only use the Superforms
// surface named below. If the component destructures or reads a field this
// stub does not provide, the Proxy throws naming the missing field — instead
// of the pre-#1742 silent `undefined` that failed (or passed) far from the
// cause. `then` and symbol probes stay inert so the object is not mistaken
// for a thenable by hosts and inspectors.
import { writable, type Writable } from 'svelte/store';

type InviteSuperForm = {
  form: Writable<{ inviteName: string; inviteEmail: string; inviteGithub: string }>;
  errors: Writable<Record<string, unknown>>;
  constraints: Writable<Record<string, unknown>>;
  message: Writable<{ type: string; text: string } | null>;
  submitting: Writable<boolean>;
  enhance: (form: HTMLFormElement) => { destroy(): void };
};

export function superForm(seed?: unknown, options?: unknown): InviteSuperForm {
  // Argument drift (#1742 review): the page's seed and options are recorded,
  // never silently ignored — the browser script asserts the recorded call
  // against what this fixture assumes, so a page that retunes them fails the
  // harness loudly instead of passing vacuously.
  ((globalThis as { __inviteSuperFormCalls?: Array<{ seed: unknown; options: unknown }> }).__inviteSuperFormCalls ??= []).push({ seed, options });
  const provided: InviteSuperForm = {
    form: writable({ inviteName: '', inviteEmail: '', inviteGithub: '' }),
    errors: writable({}),
    constraints: writable({}),
    message: writable(null),
    submitting: writable(false),
    enhance: () => ({ destroy() {} }),
  };
  return new Proxy(provided, {
    get(target, key: string | symbol) {
      if (typeof key === 'symbol' || key === 'then' || key in target) return target[key as keyof InviteSuperForm];
      throw new Error(
        `Superforms stub drift: superForm().${String(key)} is not provided by src/lib/test/fixtures/invite-copy-forms.ts — extend the stub there if the Invite page now uses it.`,
      );
    },
  });
}
export function zod4Client() { return {}; }

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

export function superForm(): InviteSuperForm {
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

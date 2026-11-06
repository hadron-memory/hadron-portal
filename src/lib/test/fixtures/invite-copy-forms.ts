// Clipboard harness only: invitation creation is deliberately not exercised.
import { writable } from 'svelte/store';
export function superForm() {
  return { form: writable({ inviteName: '', inviteEmail: '', inviteGithub: '' }),
    errors: writable({}), constraints: writable({}), message: writable(null),
    submitting: writable(false), enhance: () => ({ destroy() {} }) };
}
export function zod4Client() { return {}; }

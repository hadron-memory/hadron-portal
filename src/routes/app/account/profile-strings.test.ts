/**
 * #1080, item 5: the account profile's help, status and error copy goes
 * through `t()` (account-profile-strings.ts), not inline literals in the page
 * and its action.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/routes/app/account/+page.svelte', 'utf8');
const action = readFileSync('src/routes/app/account/+page.server.ts', 'utf8');

describe('account profile copy is localizable (#1080)', () => {
  it.each([
    'Changing your email address is not supported here.',
    'Profile updated.',
    'Failed to update profile',
  ])('"%s" is not inlined in the page or its action', (literal) => {
    expect(page).not.toContain(literal);
    expect(action).not.toContain(literal);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { expectDistinctFormIds, formIdsOf } from './expectDistinctFormIds';

const a = z.object({ _kind: z.literal('a').default('a'), userId: z.string().default('') });
const b = z.object({ _kind: z.literal('b').default('b'), userId: z.string().default('') });

describe('expectDistinctFormIds', () => {
  it('fails for two same-shaped schemas without explicit ids', async () => {
    const data = { one: await superValidate(zod4(a)), two: await superValidate(zod4(b)) };
    expect(() => expectDistinctFormIds(data)).toThrow(/one, two/);
  });
  it('passes once each form carries its own id', async () => {
    const data = { one: await superValidate(zod4(a), { id: 'a' }), two: await superValidate(zod4(b), { id: 'b' }) };
    expect(() => expectDistinctFormIds(data)).not.toThrow();
  });
  it('finds forms in nested objects and ignores non-forms', async () => {
    const data = { group: { one: await superValidate(zod4(a), { id: 'a' }) }, name: 'x', n: 1, nothing: null };
    expect(formIdsOf(data)).toEqual([{ key: 'group.one', id: 'a' }]);
  });
  it('refuses a result with too few forms, so a page that stops returning them cannot pass', async () => {
    const data = { one: await superValidate(zod4(a)) };
    expect(() => expectDistinctFormIds(data)).toThrow();
  });
});

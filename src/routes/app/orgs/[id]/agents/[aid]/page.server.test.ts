import { expect, it } from 'vitest';
import { load } from './+page.server';
it('org Agents use the same canonical inheritance view', async () => {
  await expect(load({ params: { id: 'org', aid: 'agent' }, parent: async () => ({}) } as never)).rejects.toMatchObject({ status: 303, location: '/app/agents/agent' });
});

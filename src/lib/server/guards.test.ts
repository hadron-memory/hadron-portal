/**
 * #627: requireNonConsumer must let a consumer-mode user through when they're on
 * a memory they own directly (org-less personal/private → graph.organizationId
 * == null), while still bouncing them from org-scoped surfaces.
 */
import { describe, expect, it } from 'vitest';
import { requireNonConsumer } from './guards';

async function run(parentData: Record<string, unknown>) {
  try {
    await requireNonConsumer(async () => parentData);
    return null; // no redirect
  } catch (e) {
    return e; // redirect throws
  }
}

describe('requireNonConsumer', () => {
  it('bounces a consumer with no memory graph (org-scoped route)', async () => {
    expect(await run({ isConsumerMode: true, activeOrgId: 'org-1' })).toMatchObject({
      status: 303,
      location: '/app/orgs/org-1/',
    });
  });

  it('bounces a consumer on an org-scoped memory (organizationId set)', async () => {
    expect(
      await run({ isConsumerMode: true, activeOrgId: 'org-1', graph: { organizationId: 'org-1' } }),
    ).toMatchObject({ status: 303 });
  });

  it('#627: allows a consumer on a memory they own (organizationId == null)', async () => {
    expect(
      await run({ isConsumerMode: true, activeOrgId: 'org-1', graph: { organizationId: null } }),
    ).toBeNull();
  });

  it('never bounces a non-consumer', async () => {
    expect(await run({ isConsumerMode: false, activeOrgId: 'org-1' })).toBeNull();
  });

  it('sends a consumer with no active org to /app/memories (not /app/orgs/, which would loop)', async () => {
    expect(await run({ isConsumerMode: true, activeOrgId: null })).toMatchObject({
      status: 303,
      location: '/app/memories',
    });
  });
});

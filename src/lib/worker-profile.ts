import type { Worker } from '$lib/types';

/** #1334: hasLiveSession is boolean for participants, null when internals are withheld.
 * False means an unbound participant, not a Profile-tier reader. Worker.app has
 * a different gate and cannot decide this. Missing signal fails closed.
 */
export const workerInternalsVisible = (worker: Pick<Worker, 'hasLiveSession'>): boolean =>
  typeof worker.hasLiveSession === 'boolean';

/** Profile plus the separately authorized Details Agent, never stale internal data. */
export function profileWorker(worker: Worker): Worker {
  return {
    id: worker.id, appId: worker.appId, agentId: worker.agentId,
    name: worker.name, slug: worker.slug, urn: worker.urn, portalUrl: worker.portalUrl,
    role: worker.role, appUrn: worker.appUrn, appName: worker.appName, ownerName: worker.ownerName,
    createdAt: worker.createdAt, retiredAt: worker.retiredAt,
    agent: worker.agent, memoryId: null, hasLiveSession: null,
  };
}

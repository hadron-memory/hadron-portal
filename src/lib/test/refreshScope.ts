import type { RefreshMarkerScope } from '$lib/tickers/refresh-marker';

/** portal#1462: a full marker scope for a test, defaulting to worker `w-A` of App `app-1` for viewer `u-1`. */
export function refreshScope(viewer = 'u-1', worker = 'w-A', over: Partial<RefreshMarkerScope> = {}): RefreshMarkerScope {
  return { viewer, worker, workerId: worker, workerUrn: null, appId: 'app-1', orgId: null, ...over };
}

import { fmtRunTime } from '$lib/flow/runs';

/**
 * What the secrets table's Updated column shows for its accessor value (epoch milliseconds), so the
 * global filter matches the text on screen. The cell renders the ISO `updatedAt` through the same
 * formatter: the filter hands it an ISO string too, not the milliseconds as digits, which only
 * parse through parseApiDate's tolerance for pre-#834 servers (documented there as removable).
 */
export const updatedFilterText = (ms: unknown): string => (typeof ms === 'number' && ms > 0 ? fmtRunTime(new Date(ms).toISOString()) : '');

// Shared row shape for the usage-events grid (UsageEventsTable) and the loaders
// that feed it. Mirrors the UsageEvent fields requested by USAGE_EVENTS_QUERY.
export interface UsageEvent {
  id: string;
  type: string;
  nodeLoc: string | null;
  appId: string | null;
  sessionId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

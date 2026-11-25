/**
 * The Tickers section's props from the shape the retired /tickers page took as `data` (`app` plus the panel's
 * fields), so the list's tests keep their data literals while mounting `AppTickers.svelte`.
 */
export function sectionProps({ app, ...panel }: { app: { id: string; name: string } } & Record<string, unknown>) {
  return { appId: app.id, app, panel };
}

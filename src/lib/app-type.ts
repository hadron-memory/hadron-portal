/**
 * portal#2275 — the App type union, declared once in a lib module so the route
 * schema (src/routes/app/apps/[appId]/schema.ts) and the label source
 * (src/lib/i18n/app-type-strings.ts) both consume it, instead of a lib module
 * reaching into a route for its type.
 *
 * Must stay equal to the server's AppType enum, in the Settings select's order.
 */
export const APP_TYPES = ['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT'] as const;
export type AppType = (typeof APP_TYPES)[number];

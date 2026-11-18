/**
 * portal#2249 — the App type's user-facing labels, one source for every place
 * that names an App type to a reader.
 *
 * Used by the Profile tab's Type row, the Settings read-only Type row and the
 * Settings `<option>`s (src/routes/app/apps/[appId]/+page.svelte), so the
 * three cannot drift. The value list is pinned against the `appType` z.enum
 * in src/routes/app/apps/[appId]/schema.ts by app-type-strings.test.ts: a new
 * enum value without a label fails that test.
 *
 * Pattern matches the other `*-strings.ts` modules: user-visible strings
 * route through `t(id, defaultText)` per Constitution Principle III, with
 * stable `app.type.*` ids.
 */

import { t } from './t';

const LABELS: Record<string, () => string> = {
  WORKSTATION: (): string => t('app.type.workstation', '💻 Workstation'),
  CHATBOT: (): string => t('app.type.chatbot', '💬 Chatbot'),
  AGENT: (): string => t('app.type.agent', '🤖 Agent'),
  AUTOMATION: (): string => t('app.type.automation', '⚙️ Automation'),
  CLOUD: (): string => t('app.type.cloud', '☁️ Cloud'),
  IOT: (): string => t('app.type.iot', '📡 IoT'),
};

/** The six App types, in the Settings select's order. */
export const APP_TYPE_VALUES = Object.keys(LABELS) as unknown as readonly string[];

/**
 * The label an App type renders with (icon included), or the raw value when
 * it has no label. The only state that reaches the fallback is a value from a
 * newer server the portal's z.enum has not caught up with; it renders as the
 * raw token, never blank.
 */
export function appTypeLabel(value: string): string {
  return LABELS[value]?.() ?? value;
}

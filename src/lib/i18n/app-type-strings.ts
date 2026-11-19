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

import type { z } from 'zod';
import type { appSettingsSchema } from '../../routes/app/apps/[appId]/schema';
import { t } from './t';

type AppType = z.infer<typeof appSettingsSchema>['appType'];

// `satisfies` makes a new enum value without a label a compile error here, not
// only a failing test; the keys stay literal so `Object.keys` below is typed.
const LABELS = {
  WORKSTATION: (): string => t('app.type.workstation', '💻 Workstation'),
  CHATBOT: (): string => t('app.type.chatbot', '💬 Chatbot'),
  AGENT: (): string => t('app.type.agent', '🤖 Agent'),
  AUTOMATION: (): string => t('app.type.automation', '⚙️ Automation'),
  CLOUD: (): string => t('app.type.cloud', '☁️ Cloud'),
  IOT: (): string => t('app.type.iot', '📡 IoT'),
} satisfies Record<AppType, () => string>;

/** The six App types, in the Settings select's order. */
export const APP_TYPE_VALUES: readonly AppType[] = Object.freeze(Object.keys(LABELS) as AppType[]);

/**
 * The label an App type renders with (icon included), or the raw value when
 * it has no label. The only state that reaches the fallback is a value from a
 * newer server the portal's z.enum has not caught up with; it renders as the
 * raw token, never blank (null and undefined render as an empty string).
 * Own keys only: `toString` or `__proto__` must not resolve off the prototype.
 */
export function appTypeLabel(value: string | null | undefined): string {
  if (value == null) return '';
  return Object.hasOwn(LABELS, value) ? LABELS[value as AppType]() : value;
}

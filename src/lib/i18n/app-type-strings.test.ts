/**
 * portal#2249 — pins for the App type label source.
 *
 * The six labels are pinned against the `appType` z.enum in
 * src/routes/app/apps/[appId]/schema.ts: a new enum value without a label
 * fails the coverage test, and a label whose value the schema rejects fails
 * the reverse test, so the shared source and the schema cannot drift apart.
 * The fallback (an unknown value renders raw, never blank) is pinned here and
 * rendered in app-type-label.client.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { APP_TYPE_VALUES, appTypeLabel } from './app-type-strings';
import { appSettingsSchema } from '../../routes/app/apps/[appId]/schema';

const EXPECTED: Record<string, string> = {
  WORKSTATION: '💻 Workstation',
  CHATBOT: '💬 Chatbot',
  AGENT: '🤖 Agent',
  AUTOMATION: '⚙️ Automation',
  CLOUD: '☁️ Cloud',
  IOT: '📡 IoT',
};

/**
 * The appType z.enum's members, read off the schema so the pin tracks it.
 * `.prefault()` wraps the enum, so the members sit on `def.innerType.options`
 * (`.options` forwarding is not present under the test-runner's resolution).
 */
const enumValues = (): string[] => {
  const field = appSettingsSchema.shape.appType as unknown as { def?: { innerType?: { options?: string[] } } };
  const options = field.def?.innerType?.options;
  if (!Array.isArray(options)) {
    throw new Error('appType is no longer a prefault-wrapped z.enum: update enumValues() in app-type-strings.test.ts');
  }
  return options;
};

describe('app type label source (#2249)', () => {
  it('every appType enum value maps to its label', () => {
    expect([...enumValues()].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const value of enumValues()) expect(appTypeLabel(value)).toBe(EXPECTED[value]);
  });

  it('APP_TYPE_VALUES carries exactly the enum values, in the Settings select order', () => {
    expect([...APP_TYPE_VALUES].sort()).toEqual([...enumValues()].sort());
    expect([...APP_TYPE_VALUES]).toEqual(['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT']);
  });

  it('reading the enum values does not reorder the schema\'s live options array', () => {
    const before = [...enumValues()];
    enumValues();
    expect(enumValues()).toEqual(before);
  });

  it('an unknown value falls back to the raw value', () => {
    expect(appTypeLabel('FUTURE')).toBe('FUTURE');
  });

  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty'])(
    'the Object.prototype key %s falls back to the raw value, never a function result or a throw',
    (key) => {
      expect(appTypeLabel(key)).toBe(key);
    },
  );

  it.each([undefined, null])('%s renders as an empty string, never undefined', (value) => {
    expect(appTypeLabel(value as unknown as string)).toBe('');
  });
});

// portal#2131: the findings-leg failure messages the native self-test looks for (or looks for the absence of).
// The layout script builds them here and the self-test takes its needles from here, so rewording a message
// moves both together; scripts/lib/cell-harness-messages.test.ts proves each needle still matches its message.
import { POINTER_REGRESSION } from './cell-harness-checks.mjs';

export const NEEDLES = {
  severityFields: 'expected 2 severity fields, found',
  wrapControlMissed: 'to escape with the severity wrap stripped',
  // #2169: a phrase unique to these messages, not the bare word (which any vertical-layout output would match).
  vertical: 'vertical-cell control',
  pointerRegression: POINTER_REGRESSION,
};

export const messages = {
  severityFields: (leg, found) => `${leg}: ${NEEDLES.severityFields} ${found}`,
  wrapControlMissed: (leg, got) => `${leg}: expected rows [markers, plain] ${NEEDLES.wrapControlMissed}, got [${got.join(', ')}]`,
  verticalPrecondition: (leg, tallest) => `${leg}: ${NEEDLES.vertical} precondition: tallest cell ${Math.round(tallest)}px, need > 400`,
  verticalNotDetected: leg => `${leg}: ${NEEDLES.vertical} negative (text displaced) was not detected`,
  verticalLeftEscape: leg => `${leg}: ${NEEDLES.vertical} left an escape behind`,
};

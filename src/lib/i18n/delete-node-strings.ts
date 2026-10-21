/**
 * #1160 — the node Danger-zone confirmation. The default delete is SOFT (the
 * node is only stamped deleted and stays reachable through the memory's
 * "Include deleted" filter), so the copy must not claim it cannot be undone.
 */

import { t } from './t';

export const deleteNodeStrings = {
  confirmPrompt: (name: string): string =>
    t(
      'node.danger-zone.confirm-prompt',
      `Delete "${name}"? You can still find it with Include deleted in the memory's node list.`,
    ),
};

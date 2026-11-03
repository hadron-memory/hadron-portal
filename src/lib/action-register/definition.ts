import type { AppOption } from '$lib/server/action-register';
import type { IndexRead } from '$lib/server/action-register';

/** What the definition page's section is showing. Built on the server by `loadDefinitionRegister`. */
export type DefinitionRegister =
  | { kind: 'unavailable' }
  | { kind: 'options-failed' }
  | {
      kind: 'ready';
      apps: AppOption[];
      /** The chosen App: preselected only when it is the one option, never guessed otherwise. */
      app: AppOption | null;
      appId: string | null;
      index: IndexRead | null;
      limit: number;
      offset: number;
      definitionUrn: string;
    };

import { t } from '$lib/i18n/t';
export type Read<T> =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'not-shown' }
  | { state: 'ok'; value: T };
export type InstallNode = {
  id: string;
  urn?: string | null;
  loc: string;
  name: string;
  content: string | null;
  revision: number;
};
export type InstallList = {
  memoryId: string;
  urn: string | null;
  nodes: Pick<InstallNode, 'id' | 'urn' | 'loc' | 'name'>[];
  total: number;
  offset: number;
};
export type CustomisationRead = {
  list: Read<InstallList>;
  replacement: Read<InstallNode>;
  original: Read<InstallNode>;
};
export const customisationKey = (
  app: string,
  agent: string,
  loc: string | null,
) => JSON.stringify([app, agent, loc]);
export function customisationRefusalLead(code: string | null): string | null {
  switch (code) {
    case 'AGENT_NOT_INSTALLED':
    case 'INSTALL_TARGET_CHANGED':
    case 'APP_UNINSTALLED':
      return t(
        'customisation.changed',
        'The installation changed. Reload before trying again.',
      );
    case 'INSTALL_MEMORY_NOT_FOUND':
      return t(
        'customisation.not-found',
        'The customisation is not available. Reload before trying again.',
      );
    case 'NODE_WRITE_CONFLICT':
    case 'NodeLocConflictError':
      return t(
        'customisation.conflict',
        'Another edit was saved. Your draft is kept; reload to start from the current version.',
      );
    case 'FORBIDDEN':
      return t(
        'customisation.forbidden',
        'This change was refused. Your draft is kept.',
      );
    case 'URN_NOT_QUALIFIED':
      return t('customisation.loc', 'Use a bare loc for this customisation.');
    default:
      return null;
  }
}

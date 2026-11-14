export type GrantActionDefinition = {
  name: string;
  parameters: { name: string; type: string; refusesWildcard: boolean }[];
};

export function grantableAction(action: GrantActionDefinition): boolean {
  return action.parameters.every((p) => p.type === 'node-ref') &&
    new Set(action.parameters.map((p) => p.name)).size === action.parameters.length;
}

export function isActionDefinition(value: unknown): value is GrantActionDefinition {
  if (!value || typeof value !== 'object') return false;
  const a = value as GrantActionDefinition;
  return typeof a.name === 'string' && a.name.length > 0 && Array.isArray(a.parameters) &&
    a.parameters.every((p) => p && typeof p.name === 'string' && p.name.length > 0 &&
      typeof p.type === 'string' && typeof p.refusesWildcard === 'boolean');
}

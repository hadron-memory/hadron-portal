const CREATE_ROLE_RULE_DOCUMENT = /* GraphQL */ `
mutation CreateRoleRule($memoryRef: ID!, $input: CreateNodeRoleRuleInput!) {
  createNodeRoleRule(memoryRef: $memoryRef, input: $input) {
    rule {
      role
      enabled
      strictSubRoles
      writers
      validateBy
      authorTask
      authorTaskId
      authorTaskState
      validationTask
      validationTaskId
      validationTaskState
      descriptionNode
      descriptionNodeId
      descriptionNodeState
      id
      revision
      locked
      sourceTemplate {
        id
        name
        deleted
      }
    }
    warnings {
      code
      role
      field
    }
  }
}
`;
const UPDATE_ROLE_RULE_DOCUMENT = /* GraphQL */ `
mutation UpdateRoleRule($ref: ID!, $input: UpdateNodeRoleRuleInput!, $expectedRevision: Int!) {
  updateNodeRoleRule(
    ref: $ref
    input: $input
    expectedRevision: $expectedRevision
  ) {
    rule {
      role
      enabled
      strictSubRoles
      writers
      validateBy
      authorTask
      authorTaskId
      authorTaskState
      validationTask
      validationTaskId
      validationTaskState
      descriptionNode
      descriptionNodeId
      descriptionNodeState
      id
      revision
      locked
      sourceTemplate {
        id
        name
        deleted
      }
    }
    warnings {
      code
      role
      field
    }
  }
}
`;
const DELETE_ROLE_RULE_DOCUMENT = /* GraphQL */ `
mutation DeleteRoleRule($ref: ID!, $expectedRevision: Int!) {
  deleteNodeRoleRule(ref: $ref, expectedRevision: $expectedRevision)
}
`;
const UNLOCK_ROLE_RULE_DOCUMENT = /* GraphQL */ `
mutation UnlockRoleRule($ref: ID!) {
  unlockNodeRoleRule(ref: $ref) {
    rule {
      role
      enabled
      strictSubRoles
      writers
      validateBy
      authorTask
      authorTaskId
      authorTaskState
      validationTask
      validationTaskId
      validationTaskState
      descriptionNode
      descriptionNodeId
      descriptionNodeState
      id
      revision
      locked
      sourceTemplate {
        id
        name
        deleted
      }
    }
    warnings {
      code
      role
      field
    }
  }
}
`;
const CREATE_ROLE_TEMPLATE_DOCUMENT = /* GraphQL */ `
mutation CreateRoleTemplate($ownerType: MemoryConfigTemplateOwnerType!, $ownerRef: ID!, $input: CreateMemoryConfigTemplateInput!) {
  createMemoryConfigTemplate(
    ownerType: $ownerType
    ownerRef: $ownerRef
    input: $input
  ) {
    template {
      id
      name
      description
      required
      revision
      rules {
        role
        enabled
        strictSubRoles
        writers
        validateBy
        authorTask
        authorTaskId
        authorTaskState
        validationTask
        validationTaskId
        validationTaskState
        descriptionNode
        descriptionNodeId
        descriptionNodeState
      }
    }
    warnings {
      code
      role
      field
    }
  }
}
`;
const UPDATE_ROLE_TEMPLATE_DOCUMENT = /* GraphQL */ `
mutation UpdateRoleTemplate($ref: ID!, $input: UpdateMemoryConfigTemplateInput!, $expectedRevision: Int!) {
  updateMemoryConfigTemplate(
    ref: $ref
    input: $input
    expectedRevision: $expectedRevision
  ) {
    template {
      id
      name
      description
      required
      revision
      rules {
        role
        enabled
        strictSubRoles
        writers
        validateBy
        authorTask
        authorTaskId
        authorTaskState
        validationTask
        validationTaskId
        validationTaskState
        descriptionNode
        descriptionNodeId
        descriptionNodeState
      }
    }
    warnings {
      code
      role
      field
    }
  }
}
`;
const DELETE_ROLE_TEMPLATE_DOCUMENT = /* GraphQL */ `
mutation DeleteRoleTemplate($ref: ID!, $expectedRevision: Int!) {
  deleteMemoryConfigTemplate(ref: $ref, expectedRevision: $expectedRevision)
}
`;
const MEMORY_ROLE_CONFIG_AVAILABLE_DOCUMENT = /* GraphQL */ `
query MemoryRoleConfigAvailable($ref: ID!) {
  memory(ref: $ref) {
    config {
      id
    }
  }
}
`;
import type { ApplyPreview, Rulebook } from '$lib/memory-config/types';
// Request-scoped clients only. No config/template cache, including under impersonation.
type Client = { request: (query: string, variables: Record<string, unknown>) => Promise<unknown> };
export const CONFIG_QUERY = /* GraphQL */ `
query MemoryRoleConfig($ref: ID!) {
  memory(ref: $ref) {
    config {
      id
      rules {
        role
        enabled
        strictSubRoles
        writers
        validateBy
        authorTask
        authorTaskId
        authorTaskState
        validationTask
        validationTaskId
        validationTaskState
        descriptionNode
        descriptionNodeId
        descriptionNodeState
        id
        revision
        locked
        sourceTemplate {
          id
          name
          deleted
        }
      }
    }
  }
}
`;
export async function loadRulebook(client: Client, ref: string): Promise<Rulebook | null> {
  const result = await client.request(CONFIG_QUERY, { ref }) as { memory: { config: Rulebook | null } | null };
  const config = result.memory?.config;
  return config ? { ...config, rules: [...config.rules].sort((a, b) => a.role.localeCompare(b.role)) } : null;
}
function writable(impersonating: boolean) {
  if (impersonating) throw new Error('Impersonation is read-only.');
}
export async function mutateRule(client: Client, args: { impersonating: boolean; memoryRef: string; op: string; ref?: string; revision?: number; input: Record<string, unknown> }) {
  writable(args.impersonating);
  const { role, ...patch } = args.input;
  switch (args.op) {
    case 'create': return client.request(CREATE_ROLE_RULE_DOCUMENT, { memoryRef: args.memoryRef, input: args.input });
    case 'update':
      if (!Number.isSafeInteger(args.revision) || args.revision! < 1) throw new Error('Reload the rule before saving.');
      return client.request(UPDATE_ROLE_RULE_DOCUMENT, { ref: args.ref, input: patch, expectedRevision: args.revision });
    case 'delete':
      if (!Number.isSafeInteger(args.revision) || args.revision! < 1) throw new Error('Reload the rule before deleting.');
      return client.request(DELETE_ROLE_RULE_DOCUMENT, { ref: args.ref, expectedRevision: args.revision });
    case 'unlock': return client.request(UNLOCK_ROLE_RULE_DOCUMENT, { ref: args.ref });
    default: throw new Error('Unknown rule action.');
  }
}
const APPLY = /* GraphQL */ `
mutation ApplyRoleTemplate($templateRef: ID!, $memoryRef: ID!, $dryRun: Boolean!, $expectedTemplateRevision: Int) {
  applyMemoryConfigTemplate(
    templateRef: $templateRef
    memoryRef: $memoryRef
    dryRun: $dryRun
    expectedTemplateRevision: $expectedTemplateRevision
  ) {
    memoryId
    templateRevision
    required
    dryRun
    entries {
      role
      outcome
    }
    warnings {
      code
      role
      field
    }
  }
}
`;
export async function previewTemplate(client: Client, templateRef: string, memoryRef: string, impersonating: boolean): Promise<ApplyPreview> {
  writable(impersonating);
  return (await client.request(APPLY, { templateRef, memoryRef, dryRun: true }) as { applyMemoryConfigTemplate: ApplyPreview }).applyMemoryConfigTemplate;
}
export async function applyTemplate(client: Client, templateRef: string, memoryRef: string, expectedTemplateRevision: number, impersonating: boolean): Promise<ApplyPreview> {
  writable(impersonating);
  if (!Number.isSafeInteger(expectedTemplateRevision) || expectedTemplateRevision < 1) throw new Error('Preview the template again.');
  return (await client.request(APPLY, { templateRef, memoryRef, dryRun: false, expectedTemplateRevision }) as { applyMemoryConfigTemplate: ApplyPreview }).applyMemoryConfigTemplate;
}

export const TEMPLATES_QUERY = /* GraphQL */ `
query RoleTemplates($filter: MemoryConfigTemplateFilter!, $limit: Int!, $offset: Int!) {
  memoryConfigTemplates(filter: $filter, limit: $limit, offset: $offset) {
    total
    items {
      id
      name
      description
      required
      revision
      rules {
        role
        enabled
        strictSubRoles
        writers
        validateBy
        authorTask
        authorTaskId
        authorTaskState
        validationTask
        validationTaskId
        validationTaskState
        descriptionNode
        descriptionNodeId
        descriptionNodeState
      }
    }
  }
}
`;
export async function loadTemplates(client: Client, ownerType: import('$lib/memory-config/types').OwnerType, ownerRef: string) {
  const rows: import('$lib/memory-config/types').Template[] = [];
  for (let offset = 0; ;) {
    const { memoryConfigTemplates: page } = await client.request(TEMPLATES_QUERY, { filter: { ownerType, ownerRef }, limit: 20, offset }) as { memoryConfigTemplates: { total: number; items: import('$lib/memory-config/types').Template[] } };
    rows.push(...page.items);
    if (rows.length >= page.total) return rows;
    if (!page.items.length) throw new Error('Template list is incomplete. Reload to try again.');
    offset += page.items.length;
  }
}
export async function mutateTemplate(client: Client, args: { impersonating: boolean; ownerType: string; ownerRef: string; op: string; ref?: string; revision?: number; input: Record<string, unknown> }) {
  writable(args.impersonating);
  if (args.op === 'create') return client.request(CREATE_ROLE_TEMPLATE_DOCUMENT, { ownerType: args.ownerType, ownerRef: args.ownerRef, input: args.input });
  if (!Number.isSafeInteger(args.revision) || args.revision! < 1) throw new Error('Reload the template before changing it.');
  if (args.op === 'update') return client.request(UPDATE_ROLE_TEMPLATE_DOCUMENT, { ref: args.ref, input: args.input, expectedRevision: args.revision });
  if (args.op === 'delete') return client.request(DELETE_ROLE_TEMPLATE_DOCUMENT, { ref: args.ref, expectedRevision: args.revision });
  throw new Error('Unknown template action.');
}

export async function rulebookAvailable(client: Client, ref: string): Promise<boolean> {
  const result = await client.request(MEMORY_ROLE_CONFIG_AVAILABLE_DOCUMENT, { ref }) as { memory: { config: { id: string | null } | null } | null };
  return result.memory?.config != null;
}

<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { ALLOWED_NODE_TYPES, DEFAULT_NODE_TYPE } from '$lib/nodes/nodeType-catalog';
  import { nodeCreateStrings } from '$lib/i18n/node-create-strings';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const basePath = $derived(
    `/app/orgs/${data.org.id}/memories/${data.graph.id}`,
  );
  const cancelHref = $derived(`${basePath}/browse`);

  const parentTitle = $derived(
    data.parentNode?.name ?? nodeCreateStrings.fieldParentNone(),
  );
  const heading = $derived(
    data.parentNode
      ? nodeCreateStrings.heading(data.parentNode.name)
      : nodeCreateStrings.headingNoParent(),
  );

  const fieldTitle = $derived(form?.fields?.title ?? '');
  const fieldType = $derived(form?.fields?.type ?? DEFAULT_NODE_TYPE);
  const fieldParent = $derived(form?.fields?.parent ?? data.parentLoc);

  const errorKind = $derived(form?.error ?? null);

  function errorMessageFor(kind: string | null): string | null {
    switch (kind) {
      case 'titleRequired':
        return nodeCreateStrings.errorTitleRequired();
      case 'titleEmptySlug':
        return nodeCreateStrings.errorTitleEmptySlug();
      case 'typeRequired':
        return nodeCreateStrings.errorTypeRequired();
      case 'invalidType':
        return nodeCreateStrings.errorInvalidType();
      case 'permissionDenied':
        return nodeCreateStrings.errorPermissionDenied();
      case 'network':
        return nodeCreateStrings.errorNetwork();
      case 'locCollisionExhausted':
        return nodeCreateStrings.errorLocCollisionExhausted();
      default:
        return null;
    }
  }

  const titleFieldError = $derived(
    errorKind === 'titleRequired' || errorKind === 'titleEmptySlug'
      ? errorMessageFor(errorKind)
      : null,
  );
  const typeFieldError = $derived(
    errorKind === 'typeRequired' || errorKind === 'invalidType'
      ? errorMessageFor(errorKind)
      : null,
  );
  const formLevelError = $derived(
    errorKind && !titleFieldError && !typeFieldError
      ? errorMessageFor(errorKind)
      : null,
  );

  // Esc cancels with no submitted state to discard.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') goto(cancelHref);
  }

  function typeHelp(t: string): string {
    switch (t) {
      case 'info': return nodeCreateStrings.typeHelpInfo();
      case 'record': return nodeCreateStrings.typeHelpRecord();
      case 'system': return nodeCreateStrings.typeHelpSystem();
      case 'reference': return nodeCreateStrings.typeHelpReference();
      default: return '';
    }
  }
</script>

<svelte:head>
  <title>{heading} &middot; {data.graph.name} &middot; Hadron</title>
</svelte:head>

<svelte:window on:keydown={handleKeydown} />

<div class="mx-auto max-w-xl">
  <h1 class="mb-4 text-xl font-semibold text-zinc-900 dark:text-white">{heading}</h1>

  {#if data.parentMissing}
    <div class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {nodeCreateStrings.errorParentMissing()}
    </div>
  {/if}

  {#if formLevelError}
    <div class="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {formLevelError}
    </div>
  {/if}

  <form method="POST" use:enhance class="space-y-4">
    <div>
      <label for="title" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {nodeCreateStrings.fieldTitleLabel()}
      </label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="title"
        name="title"
        type="text"
        autofocus
        required
        value={fieldTitle}
        placeholder={nodeCreateStrings.fieldTitlePlaceholder()}
        class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />
      {#if titleFieldError}
        <p class="mt-1 text-xs text-red-600 dark:text-red-400">{titleFieldError}</p>
      {/if}
    </div>

    <div>
      <label for="type" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {nodeCreateStrings.fieldTypeLabel()}
      </label>
      <select
        id="type"
        name="type"
        value={fieldType}
        class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        {#each ALLOWED_NODE_TYPES as t}
          <option value={t}>{t}</option>
        {/each}
      </select>
      <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{typeHelp(fieldType)}</p>
      {#if typeFieldError}
        <p class="mt-1 text-xs text-red-600 dark:text-red-400">{typeFieldError}</p>
      {/if}
    </div>

    <div>
      <label for="parent" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {nodeCreateStrings.fieldParentLabel()}
      </label>
      <select
        id="parent"
        name="parent"
        value={fieldParent}
        class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        <option value="">{nodeCreateStrings.fieldParentNone()}</option>
        {#each data.writableSiblings as sib}
          <option value={sib.loc}>{sib.name} <span class="text-zinc-400">({sib.loc})</span></option>
        {/each}
      </select>
    </div>

    <div class="flex items-center gap-2 pt-2">
      <button
        type="submit"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {nodeCreateStrings.buttonCreate()}
      </button>
      <a
        href={cancelHref}
        class="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        {nodeCreateStrings.buttonCancel()}
      </a>
    </div>
  </form>
</div>

# Portal extensions

A deployment can add its own screens to this portal without forking it. An
extension is a directory `src/lib/ext/<id>/` that stays **untracked**:
`.gitignore` lists `/src/lib/ext/*/`, and `scripts/check-no-private-ext.mjs`
(workflow `no-private-ext`) fails if a directory there is tracked or a tracked
file carries the marker it names. The registry, its types, this file and the
registry test sit directly in `src/lib/ext/` and are tracked.

An ordinary build of this repository has no extension and behaves exactly as it
does without this directory.

## The contract

- `src/lib/ext/<id>/index.ts` default-exports a `PortalExtension`
  (`types.ts`). `id` is a lowercase slug and equals the directory name; a build
  fails if it does not, or if two extensions share one.
- `registry.ts` collects every `index.ts` at build time with `import.meta.glob`.
  Extensions are ordered by `id`; within one extension, tabs and commands keep
  the order it returns.
- A duplicate extension id, tab id, tab href, command id or command trigger
  throws when the registry loads. It is a build failure, never a silent
  overwrite. Org tabs and account tabs are separate lists: one extension may use
  the same tab id in both. An id must be a lowercase slug and a trigger lowercase.
- Tab ids and hrefs are checked once, with an empty context, so they must not
  depend on the viewer or the organization. What a tab shows may.
- An extension function that throws breaks every page that renders its tabs;
  keep them total.
- `index.ts` is bundled for the browser, so it must not import `$lib/server/*`
  or `$env/dynamic/private`.
- Routes are ordinary files under `src/routes/`. Those are **not** git-ignored,
  so every file of an extension outside `src/lib/ext/<id>/` (route files
  included) must carry the marker that `scripts/check-no-private-ext.mjs`
  defines, in a comment. That marker is what makes the guard fail if such a file
  is ever staged; without it the file is invisible to the guard.
- A tab or command an extension adds is **display only**. Every route it adds
  gates in its own loader, through the server; the server decides what a viewer
  may see or do.
- Put any markup that carries Tailwind classes in components under
  `src/lib/ext/<id>/`, not only in route files. `src/app.css` names this
  directory with `@source` because Tailwind skips git-ignored paths; a class used
  only in an ignored route file may be missing from the built CSS.
- `OrgTabContext` carries no platform-admin flag and no consumer-mode flag.

## Modules extensions rely on

A change to one of these is made knowingly:

- `$lib/server/api`, `$lib/server/guards`, `$lib/gql-error`
- `$lib/i18n/t`
- `$lib/components/Breadcrumb.svelte`, `$lib/components/TabRow.svelte`,
  `$lib/components/Urn.svelte`
- `$lib/components/table/DataTable.svelte`, `$lib/table/createSvelteTable.svelte`,
  `$lib/table/features`

## Tests

Registry tests pass `exts` explicitly. Where an extension is composed in, the
default list is not empty and this directory's tests run there too.

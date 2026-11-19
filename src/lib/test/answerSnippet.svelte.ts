import { createRawSnippet } from 'svelte';

/**
 * A snippet that shows `{kind}` in a `<span data-answer>` and follows the value it is handed.
 * A raw snippet's markup is static, so `setup` keeps it in step; the runes need a `.svelte.ts` file.
 */
export const answerSnippet = createRawSnippet<[{ kind: string }]>((answer) => ({
  render: () => `<span data-answer>${answer().kind}</span>`,
  setup: (el) => {
    $effect(() => {
      el.textContent = answer().kind;
    });
  },
}));

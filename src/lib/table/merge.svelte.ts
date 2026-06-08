// Lazy, reactive object-merge used by the TanStack Svelte 5 adapter.
//
// Returns a Proxy that resolves each property by scanning sources right-to-left
// at *read* time. Because reads happen lazily inside the table's getters, a
// `$state` source is only touched when the table actually reads it — which is
// what makes the table reactive: when a template calls `table.getRowModel()`,
// the core reads `options.state` through this proxy, which reads the underlying
// `$state`, registering the dependency so the template re-runs on change.
//
// This file (and the adapter) is the "thin custom adapter over table-core" the
// official docs point to: there is no Svelte 5 build of @tanstack/svelte-table
// (the published v8 adapter imports the removed `svelte/internal`).

type AnyRecord = Record<string | symbol, unknown>;
type Source = object | (() => object | null | undefined);

function resolve(source: Source): AnyRecord {
  return ((typeof source === 'function' ? source() : source) ?? {}) as AnyRecord;
}

// Returns `T` regardless of source shapes — the table-core option types aren't
// index-signature-compatible, so the proxy is cast. This mirrors the official
// reference adapter.
export function mergeObjects<T>(...sources: Source[]): T {
  return new Proxy({} as AnyRecord, {
    get(_t, key) {
      for (let i = sources.length - 1; i >= 0; i--) {
        const obj = resolve(sources[i]);
        if (key in obj) return obj[key];
      }
      return undefined;
    },
    has(_t, key) {
      for (let i = sources.length - 1; i >= 0; i--) {
        if (key in resolve(sources[i])) return true;
      }
      return false;
    },
    ownKeys() {
      const keys = new Set<string | symbol>();
      for (const s of sources) for (const k of Reflect.ownKeys(resolve(s))) keys.add(k);
      return [...keys];
    },
    getOwnPropertyDescriptor(_t, key) {
      for (let i = sources.length - 1; i >= 0; i--) {
        const obj = resolve(sources[i]);
        if (key in obj) return { configurable: true, enumerable: true, value: obj[key], writable: true };
      }
      return undefined;
    },
  }) as T;
}

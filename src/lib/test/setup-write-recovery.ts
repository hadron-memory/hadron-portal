import { afterEach } from 'vitest';
import { resetWriteRecovery } from '$lib/write-recovery.svelte';

// The recovery store is module state by design (it must outlive a component), so
// the client lane clears it after every test.
afterEach(() => resetWriteRecovery());

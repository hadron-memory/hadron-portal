import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

interface SetupInfo {
  hasSetup: boolean;
  apiKey?: string;
  clientId?: string;
  orgId?: string;
  orgName?: string;
  bundleId?: string;
  graphs?: { id: string; name: string }[];
}

export const load: PageServerLoad = async ({ locals }) => {
  const controllerUrl = env.CONTROLLER_URL ?? 'http://localhost:4000';

  try {
    const res = await fetch(`${controllerUrl}/setup/info`, {
      headers: { Authorization: `Bearer ${locals.token}` },
    });
    const setup: SetupInfo = await res.json();
    return { setup, controllerUrl };
  } catch {
    return {
      setup: { hasSetup: false } as SetupInfo,
      controllerUrl,
    };
  }
};

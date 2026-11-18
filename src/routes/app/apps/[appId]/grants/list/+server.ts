import { json, isHttpError } from "@sveltejs/kit";
import { gqlClient } from "$lib/server/api";
import {
  grantOffset,
  readGrantPage,
  requireGrantManager,
} from "$lib/server/app-grants";
import type { RequestHandler } from "./$types";

// The confirmed Create result must survive its list readback. Kit handles an
// invalidateAll loader failure by replacing the page; this request cannot.
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const headers = { "cache-control": "no-store" };
  if (!locals.token || !locals.user?.id)
    return json({ failed: true }, { status: 401, headers });
  try {
    const client = gqlClient(locals.token);
    const app = await requireGrantManager(client, params.appId);
    const offset = grantOffset(url);
    return json(
      {
        appId: app.id,
        viewerId: locals.user.id,
        offset,
        ...(await readGrantPage(client, app.id, offset)),
      },
      { headers },
    );
  } catch (e) {
    const status =
      isHttpError(e) && [401, 403, 404].includes(e.status) ? e.status : 200;
    return json({ failed: true }, { status, headers });
  }
};

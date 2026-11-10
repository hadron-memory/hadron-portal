import { gqlClient } from '$lib/server/api';
import { MY_USER_API_KEYS_QUERY } from '$lib/server/queries';
import { readAllPages, type PageEnvelope } from '$lib/server/paged';
import type { UserApiKey } from '$lib/types';

/**
 * Every own UserApiKey of one view (portal#1615: every page followed; one
 * refused page rejects the whole read). The api-keys page loader and its list
 * re-read endpoint (#1653) both read through here, so the two cannot drift.
 */
export function readUserApiKeys(token: string, includeHidden: boolean): Promise<UserApiKey[]> {
  const client = gqlClient(token);
  return readAllPages((limit, offset) =>
    client
      .request<{ myUserApiKeysPage: PageEnvelope<UserApiKey> }>(MY_USER_API_KEYS_QUERY, { includeHidden, limit, offset })
      .then((r) => r.myUserApiKeysPage),
  );
}

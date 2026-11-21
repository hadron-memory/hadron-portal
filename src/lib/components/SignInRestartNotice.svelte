<!--
  portal#1091 — what /signin shows when /auth/callback refused the session
  exchange (`?error=auth`). Fixed text on purpose: the callback refuses for
  several reasons (a missing, mismatched or expired browser nonce, a used code)
  and the server names none of them to the portal, so the notice guesses none
  and says nothing about the account or a passkey. It offers the two ways
  forward that always exist: start again, or use an identity provider.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
</script>

<div
  role="alert"
  class="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
>
  {t('signin.restart.incomplete', "That sign-in didn't complete.")}
  {t('signin.restart.ways', 'Start again, or use GitHub, Google or Apple.')}
</div>

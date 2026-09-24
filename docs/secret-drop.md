# OSA Secure Secret Drop

The secret-drop backend is an API-only Supabase Edge Function.

Supabase documents that Edge Functions do not serve interactive HTML: GET responses with `text/html` are rewritten to `text/plain`. The browser UI therefore lives on a separate static frontend.

## Browser frontend

Production UI:

`https://osa-secret-drop.lovable.app`

One-time tokens are passed in the URL fragment:

`https://osa-secret-drop.lovable.app/#token=<one-time-token>`

Using a fragment keeps the token out of the hosting server request. The page reads it in the browser and submits the token + secret directly to the Supabase API over HTTPS.

## Backend endpoint

`POST https://jpnlmpqqtiwisxcsjwbm.supabase.co/functions/v1/osa-secret-drop`

Supported JSON flows:

- validate only: `{"token":"...","validate":true}`
- store secret: `{"token":"...","secret":"..."}`

The backend:
- returns JSON only
- supports browser CORS
- never returns stored secret values
- atomically consumes one-time tokens through `osa_consume_secret_drop`
- writes the value into Supabase Vault
- rejects expired or reused tokens

Do not put API keys or one-time tokens in Git.

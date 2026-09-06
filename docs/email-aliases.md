# Email aliases (planned)

Design note for the per-site email alias generation asked for in issue #74:
Bramble holds an API key for an alias provider the user already has, and creates
a fresh address at signup time so every site gets its own. It records the
provider surfaces, where the key lives, and which platform can reach which host,
so the shape is decided before any code.

Fast-moving facts (provider endpoints, CORS behaviour, token scopes) are dated
**September 2026** and flagged where they may shift. The unverified ones are
listed under [Open questions](#open-questions-the-spike-answers) and are what
`scripts/alias-spike.ts` exists to settle.

## What this is, and is not

Bramble is not an alias service. It holds a bearer token for the user's own
provider and makes one call on their behalf; the mail never touches us, and
neither does the forwarding configuration. The provider account is the user's
and stays the user's.

**v1 creates aliases and nothing else.** Not list, not disable, not delete, not
reconcile-with-the-vault. An alias that outlives its entry is the provider's to
turn off, in the provider's own UI, which is where the forwarding rules and
recipients already live. A password manager that half-mirrors an alias
inventory is worse than one that does not mirror it at all, because the half
that is stale is indistinguishable from the half that is not.

## The three providers

All three are a single authenticated POST once discovery is done. What differs
is the auth header, whether anything must be fetched first, and how much
configuration the user has to supply before the first alias can exist.

### Addy.io

| | |
|---|---|
| Create | `POST {base}/api/v1/aliases` |
| Headers | `Authorization: Bearer {key}`, `Content-Type: application/json`, `Accept: application/json`, `X-Requested-With: XMLHttpRequest` |
| Body | `{ domain, description?, format?, local_part?, recipient_ids?, label_ids? }` |
| Address at | `data.email` |
| Verify token | `GET {base}/api/v1/api-token-details` |
| Domains | `GET {base}/api/v1/domain-options` |
| Default base | `https://app.addy.io` |

Two things here shape the UI rather than just the client.

Addy is a Laravel app, and Laravel decides between a JSON error and a redirect to
its web login by whether the request looks like an API call. Its docs specify
`X-Requested-With: XMLHttpRequest`; measured, an unauthenticated request returns
a JSON `401 {"message":"Unauthenticated."}` with either that header or
`Accept: application/json` alone. Send both, because the cost is nothing and the
failure mode is a 302 to an HTML login page whose redirect target has no CORS,
which surfaces in a browser as an opaque network error rather than "bad key".

**`domain` is required**, and the account's available domains are only knowable
from `domain-options`. So Addy, alone of the three, cannot generate with zero
configuration: the settings screen has to fetch the domain list at connect time
and have the user pick a default. That is a real extra state (fetch, pick,
persist) and it is Addy-specific, which is an argument for the provider
descriptor owning its own settings fields rather than the settings screen
switching on provider id.

`format` is one of `random_characters`, `uuid`, `random_words`,
`random_male_name`, `random_female_name`, `random_noun`, or `custom`. Only
`custom` needs `local_part`. Offer it, default to the account's own default by
omitting the field.

Addy is self-hostable, so the base URL is configuration, never a constant.

### SimpleLogin

| | |
|---|---|
| Create | `POST {base}/api/alias/random/new?hostname={host}&mode={uuid\|word}` |
| Headers | `Authentication: {key}`, `Content-Type: application/json` |
| Body | `{ note? }` |
| Address at | `.email` |
| Verify token | `GET {base}/api/user_info` |
| Default base | `https://app.simplelogin.io` |

The auth header is **`Authentication`**, not `Authorization`, and the value is
the bare key with no `Bearer` prefix. It is the single easiest thing to get
wrong in this document and it fails as a 401 that looks exactly like a bad key.

`hostname` is a query parameter, not a body field, and it is what makes the
alias legible in the user's SimpleLogin dashboard later. Always send it.

Also self-hostable, so again: base URL is configuration.

### Fastmail

Two steps, because JMAP discovers before it acts.

1. `GET https://api.fastmail.com/jmap/session` with `Authorization: Bearer {token}`.
   Read `apiUrl`, and the account id from
   `primaryAccounts["https://www.fastmail.com/dev/maskedemail"]`.
2. `POST {apiUrl}`:

```json
{
  "using": ["urn:ietf:params:jmap:core", "https://www.fastmail.com/dev/maskedemail"],
  "methodCalls": [
    ["MaskedEmail/set", {
      "accountId": "{accountId}",
      "create": {
        "bramble": {
          "state": "enabled",
          "forDomain": "example.com",
          "description": "Bramble"
        }
      }
    }, "0"]
  ]
}
```

The address comes back at `methodResponses[0][1].created.bramble.email`, under
whatever creation id was sent. `emailPrefix` is create-only and optional;
`createdBy`, `createdAt`, `id` and `email` are server-set.

`state` is set explicitly to `enabled`. The default is `pending`, which is for
integrators that mint an address speculatively and confirm it when the user
actually uses it. Bramble's generate is already an explicit click, so the
address should work the moment it is filled. (Confirm in the spike: a `pending`
address that is never confirmed is understood to expire, and shipping that by
accident would produce aliases that quietly stop working weeks later, which is
the worst failure this feature can have.)

**The `apiUrl` pin.** The session response names the URL that the next request
sends the bearer token to. That is a server-named destination for a credential,
which is exactly the hazard `adapters/backup-creds.ts` pins target origins
against. Accept `apiUrl` only when its origin matches the session URL's origin,
and reject otherwise. Three lines, and without them a compromised or spoofed
session response harvests the token.

**Token scope.** Fastmail's OAuth scopes include
`https://www.fastmail.com/dev/maskedemail` as a distinct scope alongside
`urn:ietf:params:jmap:core`. Whether a manually created API token can be
narrowed the same way in Settings > Privacy & Security > Manage API tokens is
not settled by the public docs and is a spike question. It matters: if it can,
Fastmail is the only one of the three where the stored key cannot read the
user's mail, and that is worth saying in the settings copy.

## Transport: plain `fetch`, on every platform

The expensive assumption here was that this would need a native HTTP path per
platform, the way cloud backups do. It does not. Measured September 2026, with
an `OPTIONS` preflight carrying `Access-Control-Request-Method: POST` and
`Access-Control-Request-Headers: authorization,content-type`:

| Origin | app.addy.io | app.simplelogin.io | api.fastmail.com |
|---|---|---|---|
| `chrome-extension://...` | `*` | reflected | reflected |
| `tauri://localhost` | `*` | reflected | reflected |
| `capacitor://localhost` | `*` | reflected | reflected |
| `https://localhost` | `*` | reflected | reflected |

All three answer a cross-origin preflight, and two of them reflect whatever
origin is asked. So the client is one implementation in `core`, calling `fetch`,
shared by the extension, the desktop and both mobile apps. No `net` adapter, no
Rust command, no Capacitor HTTP plugin.

This is the opposite of the backups situation and worth understanding rather
than just enjoying, because the difference is not luck: these are consumer APIs
whose vendors expect browser-extension callers, while no S3 endpoint or WebDAV
server has any reason to grant CORS to `tauri://localhost` (see
[cloud-storage-backups.md](cloud-storage-backups.md)). A self-hosted Addy or
SimpleLogin behind someone's own reverse proxy inherits none of this, so a
self-hosted base URL failing CORS is a supported failure and needs an error
message that says so rather than "network error".

A preflight is not a response, so this was measured again against the real
endpoints (an unauthenticated `GET` of each provider's token-details equivalent,
all four origins, twelve combinations). Every one returned its `401` carrying an
acceptable `Access-Control-Allow-Origin`: `*` from Addy, the reflected origin
from the other two. So the header is not a preflight-only courtesy, and an error
response reaches the client as a readable status rather than an opaque network
failure, which is what makes "wrong API key" reportable at all.

The remaining gap is narrow but real: only an authenticated `2xx` proves the
success path, since a server can route errors and successes through different
middleware. That is spike question 1.

Two caveats carried forward:

- Redirects are not followed (`redirect: "manual"`, and reject rather than
  chase). A redirect out of an API call means the session was rejected and the
  destination is an HTML login page with no CORS, so following it converts a
  clean "bad key" into an opaque failure. The desktop's backup transport already
  takes this position (`reqwest::redirect::Policy::none()`, `backup.rs`).
- Every request sends `credentials: "omit"`. `api.fastmail.com` returns
  `access-control-allow-credentials: true`, and ambient cookies have already
  cost this repo a day once (1255ab7b, WebDAV uploads authenticating as the
  wrong thing). The token goes in a header, deliberately and only.

## Where the key lives

The API key is a bearer secret against the user's account. For Addy and
SimpleLogin it is account-capable: it can list existing aliases, read
recipients, and delete. It is a vault secret and is treated as one.

- **VEK-wrapped, like `BackupSecrets` on every platform except desktop.** It is
  never written in plaintext to `storage.local` or to a keychain.
- **Vault-scoped** (`<key>:<vaultId>`, `syncKeyFor`), not device-scoped. It
  grants a capability, and CONTEXT.md's MUST rule settles the arguable cases in
  that direction. A second vault must not inherit the first one's ability to
  spend someone's alias quota.
- **Generation therefore requires an unlocked vault.** This costs nothing real:
  the in-page suggestion and the entry form both already require unlock, and
  the extension background reaches the VEK through offscreen exactly as autofill
  does.
- Unlike the desktop's backup credentials, there is **no OS-credential-store
  tier**. The reason that tier exists is unattended scheduled runs; alias
  creation is always a user gesture in a foreground window, so there is nothing
  to keep working while locked.

## Consent and egress

This is the app's second network egress after the HIBP breach check, and the
README and Settings both currently say the breach check is the only one.

It is a different kind of egress and gets a different treatment. HIBP is a
background check that would otherwise happen silently against every saved
password, so it is a global toggle, off by default. Alias creation is a user
action against a service the user configured with their own credentials.
**Configuring a provider is the opt-in**; a second master switch on top of it
would be ceremony, not consent. What is owed instead:

- The settings copy names the exact host that will be contacted, including the
  self-hosted case where the user named it themselves.
- The website privacy policy gains this egress alongside HIBP.
- Nothing is contacted before a provider is configured, and no request carries
  anything but the token, the site's domain and a description.

## Surfaces

Cross-platform, in `core`:

- **Settings > Email aliases.** Provider, base URL, API key, verify button,
  plus the provider's own fields (Addy's domain and format). Verify calls the
  provider's token-details endpoint, which is a read, so a wrong key fails
  before it ever tries to create anything.
- **The entry form.** A generate button on the username field, mirroring the
  password field's generate. Fills the created address, and the entry's own name
  or first URL becomes `forDomain` / `hostname` / `description`, which is what
  makes the alias identifiable in the provider's dashboard six months later.

Extension only:

- **The in-page suggestion** on a detected signup form, offering an alias for
  the email field the way one is already offered for the password field.

## The side effect that shapes the in-page surface

Generating a password is free and repeatable. Generating an alias creates a real
record on a real account and spends real quota, and on some plans that quota is
small. Every consequence follows from that.

The generated-password suggestion rides along on the autofill query and is drawn
the moment the response lands (1e7fe405), precisely because generating early
costs nothing. An alias cannot work that way. It must be:

- **click-only.** Never on paint, never on hover, never speculatively while a
  form is being scored.
- **a round trip with visible states.** A spinner while in flight and a real
  error row on failure, inside the in-page UI, which today has no concept of a
  suggestion that can fail.
- **not regenerated casually.** The password suggestion's regenerate button is
  free to press repeatedly. An alias regenerate abandons an address that already
  exists at the provider, so it needs either a confirmation or no button at all.

There is also a new trigger to build. `shouldSuggestPassword` gates on
`field.type !== "password"` (`content/signup-detect.ts:463`) and the whole
suggestion cache is keyed to password fields, so offering on an email field is a
new entry point into `scoreSignupForm`, not a new row in an existing menu. This
is why Phase 4 is the largest phase despite being the smallest amount of network
code.

## Open questions (the spike answers)

`pnpm run spike:aliases` (`scripts/alias-spike.ts`) runs against the user's own
accounts and settles these. It is read-only unless `--create` is passed, because
a create is a real record on a real account.

1. Does an authenticated **2xx** carry `Access-Control-Allow-Origin`? The `401`s
   already do, on all twelve provider/origin combinations, so this is the last
   piece of the transport question rather than the whole of it.
2. Does Addy accept a create without `format`, and what does `domain-options`
   actually return for a free account?
3. Is SimpleLogin's `Authentication` header still correct, and does
   `?hostname=` land in the dashboard where expected?
4. Fastmail: does a manually created API token carry a masked-email scope, or is
   it whole-account? Does `state: "enabled"` come back enabled, and what is the
   real lifetime of a `pending` one?
5. What does each provider return when the **quota is exhausted**? This is the
   error path users will actually hit, and it needs a distinguishable message
   rather than a generic failure.
6. Rate limits, undocumented on all three.

## Phases

| Phase | Work |
|---|---|
| 0 | This document, plus the spike script. |
| 1 | `core/aliases/`: provider descriptors, the three clients, zod-validated responses, VEK-wrapped key storage, tests. |
| 2 | Shared UI: the settings section and the entry-form button, in six locales. |
| 3 | Extension in-page suggestion: the email-field trigger, the picker row, the background round trip, save wiring, `_locales`, dom tests. |
| 4 | Device testing on both mobile platforms and both browsers, docs, release. |

Phase 1 responses are validated with zod, as the backup OAuth responses are
(031e84b0): these are third-party JSON shapes that change without warning, and
an alias address is about to be written into a vault entry.

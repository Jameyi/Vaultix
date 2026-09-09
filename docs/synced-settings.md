# Synced settings (planned)

How a setting that belongs to a *vault* rather than a *device* travels between
devices, and why the obvious ways of doing it are wrong. Written for the email
alias provider (see [email-aliases.md](email-aliases.md)), which is the first
setting to need it, but the mechanism is deliberately general.

## The problem

Settings today are device-local. Every one of them is a `storage.setMeta` key,
and sync moves exactly one thing: the `EntriesPayload`, which is
`{ entries, tombstones }` and nothing else (`sync/entries-payload.ts`). Nothing
under `core/src/sync/` calls `getMeta` or `setMeta` at all.

That is right for almost everything. An auto-lock timeout, a theme, a backup
target, a relay URL: these describe a device or a machine, and CONTEXT.md's
device-vs-vault rule already sorts them.

The alias provider is the first setting that is genuinely neither. It is not
about this browser; it is an account-level fact about the person, and the
expectation is that configuring it once is enough. Re-pasting an API key on every
device is friction with no security benefit, since the same vault key protects it
either way.

## Why the obvious approaches fail

**A field on `EntriesPayload`, added naively.** `EntriesPayloadSchema` is a plain
`z.object`, so zod strips unknown keys, and `encodeEntriesPayload` re-parses on
every write (`entries-payload.ts:32`). Measured, an older client reading a payload
that carries a new field drops it on read *and* on write-back. The Chromium
extension is publicly released, so older builds exist in the wild; a naive field
would be a format that established clients quietly delete.

**A settings-shaped entry in the `entries` array.** Tempting, because entries
already have stamps, tombstones, per-entry DEKs and a merge that carries sealed
envelopes verbatim, so an old client could not drop one it did not understand.
But `getEntryMode` "falls back to login for unrecognised types"
(`app/entry-modes/index.ts:21`), so on every older device the settings record
appears in the vault list as a junk login. It would be counted in the stats, land
in exports, and, worst of all, invite deletion: one confused user tidying up their
list would tombstone it, and the tombstone would delete the configuration on every
device, forever. Trading a silent strip for a user-visible booby trap is not an
improvement.

## The mechanism

A **stamped settings record** inside `EntriesPayload`, merged by the same
last-writer-wins rule the entries use, with one rule that makes old clients
harmless:

> **Absent means "no opinion", never "deleted".**

That single rule is what makes this safe, and it works because of a property of
the merge path worth stating explicitly: `applyRemotePayload` always computes
`mergeEntriesPayload(local, remote)` and never replaces local with remote
(`sync/apply-remote.ts:69`). Each device writes its own blob. So when an old
client strips the field, it damages only its own copy, and when its stripped
payload comes back to a current device, the merge sees "they have no opinion" and
keeps what it has. An old device cannot carry the setting, and cannot destroy it.

Clearing has to be explicit for exactly the same reason. "The user pressed
Disconnect" must not be encoded as absence, because absence is what an old client
produces. A cleared setting is a present record with a stamp and a null value.

```
settings?: {
  hlc: Hlc,            // stamped like any other write, so LWW resolves conflicts
  aliases: {...} | null // null = explicitly cleared, absent = never configured
}
```

## Every seam this touches

The mechanism is small; the plumbing is not. Each of these is load-bearing, and
the first two are the ones that would ship broken without being obvious in review.

1. **`buildPayload` reconstructs the payload from `VaultEntries` on every local
   write** (`vault/entry-mutations.ts:102`). `VaultEntries` is the triple
   `{ entries, stamps, tombstones }`. Unless it also carries the settings record
   and `buildPayload` writes it through, **every ordinary entry edit silently
   wipes the synced setting**. This is the single biggest hazard in the change:
   the failure is invisible locally and only shows up as a setting that keeps
   reverting.

2. **`payloadsEquivalent` decides whether a merge is worth writing and
   re-broadcasting** (`sync/apply-remote.ts:49`), and it compares entries and
   tombstones only. A settings-only change would compare equal, so the write is
   skipped and the change never propagates. The setting would appear to sync
   only when it happened to ride along with an entry edit, which is the kind of
   bug that looks like flakiness for months.

3. **`sanitizeRemoteEntriesPayload` drops future-dated stamps** so a peer cannot
   pin an un-deletable entry by stamping it years ahead
   (`sync/entries-payload.ts:43`). The settings stamp needs the same treatment,
   or a hostile or clock-skewed peer pins a provider configuration nobody can
   change.

4. **`mergeEntriesPayload`** gains the absent-is-no-opinion rule. The merge engine
   itself is already generic over anything with an `hlc` (`sync/merge.ts:77`), so
   the comparison is free; only the "one side has nothing to say" case is new.

5. **The read path.** `readEntriesPayload` must surface the record so the app can
   use it, and `useVault` must expose it the way it exposes entries.

6. **Migration.** An existing device-local `alias.config:<vaultId>` must become
   the synced record on first run, once, without a device that has never had one
   writing an empty record that then wins the merge. Adopt only when the local
   meta key exists and the synced record does not.

7. **The settings screen** reads and writes through the synced record rather than
   `setMeta`, and says that it syncs, since the user is now pasting a key that
   will reach their other devices.

## Decisions taken

**The key is protected by the outer VEK layer only.** Entries get a second layer
(a per-entry DEK wrapped under the VEK); the settings record, living beside
`tombstones` in the payload, does not. That is the same protection the vault's
structure already has, and the threat it drops is an attacker who can read
decrypted payload bytes but not the VEK, which is not a threat model this vault
otherwise defends. Stated rather than assumed, because it is a real difference
from how entries are held.

**Vault-scoped by construction.** The record lives inside one vault's encrypted
payload, so it cannot leak into another vault. That is strictly stronger than the
`<key>:<vaultId>` convention it replaces, and it satisfies CONTEXT.md's MUST
without depending on anyone keying it correctly.

**No VLT1 change.** The record lives in the encrypted payload, so the binary
container in `vault-format.ts` is untouched, exactly as tombstones were when they
were added.

**Not a general settings bag, yet.** Only the alias provider moves. A generic
"synced settings" object invites everything to move into it, and most settings
genuinely are device-local. The shape allows a second key later without another
format change, which is the point of nesting under `settings` rather than adding
`aliases` at the top level.

## Plan

| Step | Work | Risk |
|---|---|---|
| 1 | `settings` on the payload schema; merge rule; `payloadsEquivalent`; `sanitize`. Tests first, including an old-client round trip that must not lose the record. | low, isolated |
| 2 | Thread through `VaultEntries` and `buildPayload`, so an entry edit preserves it. Test: mutate an entry, assert the record survives. | **highest**, silent if wrong |
| 3 | Read path and `useVault` exposure. | low |
| 4 | `useAliasProvider` reads and writes the synced record; migrate the meta key once. | medium, one-way |
| 5 | Settings copy: say it syncs. Locales. | low |
| 6 | Device test: configure on one device, confirm it lands on the other, then confirm an entry edit on either does not wipe it. | the one that proves it |

Estimated 2 to 3 days, most of it steps 2 and 6.

## What would make this wrong

Worth writing down so it can be checked later rather than argued about. If any of
these turn out to be true, device-local was the better answer:

- If a user wants **different providers per device** in any real number. Nothing
  here supports that, and adding it later means per-device records inside a
  synced structure, which is worse than what we replaced.
- If the API key turns out to want **rotation on one device only**, for instance
  because a provider issues per-client keys.
- If syncing a third-party credential materially widens a breach. It does not
  today: the key is already inside the vault on the device that holds it, and
  sync moves it only between devices that already share the vault key.

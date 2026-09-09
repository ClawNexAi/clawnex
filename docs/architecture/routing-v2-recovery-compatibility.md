# OpenClaw selective ownership compatibility

Implemented 2026-09-08 following operator approval after the local deployment
exposed a version-2 recovery file not covered by the version-1 fixtures.

## Read and restore

The reader accepts validated version-1, version-2 and version-3 selective
ownership records. Discovery never rewrites a recovery file or creates a key.
Version-2 records additionally own an API-key field; restoration compares its
recorded SHA-256 of the JSON value as well as the endpoint and identity header.
Operator changes are conflicts, not permission to overwrite. If the original
key was absent, restoration removes only the still-owned proxy key.

Removed-provider records stay recoverable. They do not recreate providers or
prevent unrelated providers from being wired. A restore reports them as retained
conflicts instead of claiming complete success.

## Secret-safe publication

When an approved routing operation publishes a journal containing legacy
credentials, it writes version 3. Original credentials are AES-256-GCM encrypted
with independent random 96-bit nonces and provider/field ownership authenticated
as associated data. No plaintext original API key is serialized into the new
journal, API response, or preview.

The dedicated 256-bit recovery key lives next to the selective journal with the
suffix `.credential-key`. It is created exclusively, mode 0600, and flushed
before encrypted journal publication. Existing keys are never replaced; reads
reject symlinks, hardlinks, unsafe permissions and wrong ownership. It is
independent of the ingest secret so rotating that service secret does not destroy
credential recovery. This protects against a journal-only disclosure, not an
attacker able to read the same user's key file too.

Back up the journal **and its `.credential-key` file together** using restricted
storage. Keep that key while encrypted journal backups exist, even after active
routing is restored. Losing it prevents credential restoration; the operation
fails before writing agent configuration. No key or journal is migrated merely
by installing the application.

## Evidence

`npx tsx scripts/verify-openclaw-v2-recovery.ts` covers read-only discovery, v2
restoration, v3 encrypted round trip, absent original keys, changed credentials,
missing recovery keys, ciphertext authentication failure, removed providers and
unrelated-provider routing. Existing OpenClaw/Hermes recovery, reviewed-plan,
inventory and evidence tests also pass. A source inspection against real tool
files with an in-memory database reports both modules `ok` and unchanged hashes;
no second dashboard was started.

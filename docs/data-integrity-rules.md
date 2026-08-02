# Polaris Data Integrity Rules

This document is the data-layer contract for Polaris. It is not a test plan and not a migration
plan. It defines the rules that tests, migrations, imports, cleanup tasks, and platform persistence
backends must obey.

Data integrity keeps the workspace readable for both user and model. An incomplete object must not be presented as a complete part of the current scene.

The data-layer invariant is:

> Incomplete source state stays incomplete until a complete source record is verified.

If Polaris cannot prove that a user data object was fully read or fully written,
it must preserve the last known complete truth, isolate the incomplete object, or
stop writing. It must not convert missing, unloaded, timed-out, or partially
written data into an empty or shorter persisted state.

## Data Classes

Polaris local data falls into these responsibility classes:

- **Source data:** chat messages, conversation records, workspace file content,
  reference document bodies, persona memory document bodies, asset binary
  content, provider/user configuration, collaborators, rooms, and projects.
- **Indexes and directories:** chat catalogs, project indexes, document
  manifests, asset metadata, vector indexes, summaries, local health summaries,
  and cached request projections.
- **Derived data:** previews, thumbnails, embeddings, semantic recall candidates,
  generated summaries, usage statistics, and health counts.
- **Temporary data:** durable import stages, replacement/staging directories,
  chunked-write temp files, pending indexes, and interrupted commit artifacts.

Only source data is user truth. Indexes help find truth, derived data may be
rebuilt, and temporary data must never outrank a verified source record.

## Non-Negotiable Rules

1. **A directory is not the body.**
   A catalog, manifest, index, metadata row, or pointer may make data visible,
   but it is not proof that the body exists. If the body is missing, the object
   is incomplete, not empty.

2. **Unloaded is not empty.**
   A conversation, document, or asset that has not been loaded must not be saved
   as an empty body. Loading state is UI/runtime state, not source truth.

3. **Read failure is not deletion.**
   Timeout, missing key, invalid JSON, missing chunk, missing binary, native file
   read failure, and IndexedDB transaction failure must not be interpreted as
   user deletion.

4. **A partial read cannot overwrite a complete prior state.**
   If hydration reads a shorter catalog, fewer conversations, fewer documents,
   fewer assets, or a body with missing chunks, the next persist must not write
   that shorter view unless the missing source data is explicitly proven deleted.

5. **A partial write cannot be announced as saved.**
   Multi-key or multi-store writes must either complete as a committed batch or
   leave the old committed state usable. If the backend cannot prove the batch
   completed, the app must enter an untrusted persistence state instead of
   continuing normal writeback.

6. **Cleanup cannot change the result of the main operation.**
   Import, export, restore, and migration success must not be undone because a
   cleanup step failed. Cleanup failure is logged and retried later; it does not
   trigger rollback of already verified user data.

7. **Deletion requires a fresh audit.**
   Destructive cleanup must compute its candidate set immediately before
   deletion under the same lock or transaction. A candidate list collected before
   user confirmation, import, restore, or asset save is stale and cannot be used
   to delete source data.

8. **Recovery is read-only until complete.**
   Recovery may scan old chunks, stale manifests, orphan records, backups, and
   rollback sources, but it may only write a new source record after the recovered
   object has a complete body and passes tombstone checks.

9. **Tombstones outrank orphan recovery.**
   Deleted conversation/document/asset IDs must not be revived from legacy
   chunks, stale manifests, orphan records, or vector indexes unless the user
   explicitly restores them through a verified restore flow.

10. **Derived data must never block source backup.**
    Export must prioritize source data. A missing preview, embedding, summary,
    cache entry, or derived health artifact may produce a warning, but must not
    prevent exporting otherwise complete source data.

11. **Broken source entries are isolated, not erased.**
    If a source object has metadata but lacks body/binary/chunks, it is marked
    incomplete or quarantined. It is not silently dropped from all indexes, and
    it is not rewritten as empty.

12. **Old formats are rescue sources only.**
    Legacy chunks, manifests, envelopes, pending indexes, and rollback artifacts
    may be read to rescue existing user data. Normal new writes must not create
    fresh legacy truth unless that path is explicitly part of a bounded recovery
    operation.

## Write Protocol Rules

Every write that touches user source data must identify:

- the source records being written;
- the indexes/directories being updated;
- the temporary files or rollback points involved;
- the commit marker or equivalent proof of completion;
- what happens if the process is killed after each step.

For multi-key writes, the safe sequence is:

1. Write new source records to staging or individually recoverable records.
2. Validate each new source record.
3. Commit the index/directory only after the source records exist.
4. Keep old source records until the new committed view is validated.
5. Cleanup old artifacts in a later, separately audited step.

If a platform backend cannot make the whole batch atomic, the data format must
remain recoverable after any prefix of the write sequence. Records-before-catalog
is recoverable only if startup scans orphan records even when a stale catalog is
present.

## Read Protocol Rules

Hydration must classify results before mutating store state:

- **Complete:** source body exists and validates.
- **Unloaded:** source is known to exist, but body was intentionally not read.
- **Incomplete:** index/metadata exists, but body/chunk/binary is missing or
  invalid.
- **Timed out:** backend did not prove success or failure.
- **Deleted:** explicit tombstone or user-confirmed deletion exists.

Only complete and intentionally unloaded entries may enter normal app state.
Incomplete and timed-out entries must not be marked loaded. Deleted entries must
not be recovered from stale sources.

## Migration Rules

Migration must be conservative:

- Do not migrate by rewriting the whole library at startup.
- Do not delete old source data in the same operation that creates new source
  data.
- Do not convert an incomplete old object into an empty new object.
- Do not treat successful migration of one object as proof that every object can
  be cleaned.
- Do not use app update as the only backup point.

The preferred migration flow is:

1. Read old data without destructive side effects.
2. Recover or quarantine each object independently.
3. Write new self-contained source records only for complete objects.
4. Verify the new records can be read back.
5. Keep old data as rescue material until a later cleanup pass has fresh audit
   evidence.

## Import and Export Rules

Export rules:

- Export complete source data even if derived data is damaged.
- Warn about incomplete source entries instead of silently skipping them.
- Do not throw away the whole export because one asset preview, vector index, or
  summary is missing.
- If a source body is incomplete, record that fact in export diagnostics.

Import rules:

- Stage imported source records durably before changing their live pointers.
- Validate imported source data before replacing existing source data.
- Import success is decided before cleanup.
- Cleanup failure after import success must not restore the old profile.
- A leftover import stage must be resolved from durable commit evidence at startup:
  unpublished staged records are discarded, while published staged records stay live.

## Asset Rules

Asset metadata, binary content, and previews have different authority:

- Metadata alone is not proof that the asset exists.
- Binary content is the source for images/files.
- Preview is derived and may be missing.
- Export/import must not fail entirely because a preview is missing.
- Cleanup must re-audit references immediately before deleting binary content.
- If metadata exists but binary is missing, the asset is incomplete, not deleted.

## Platform Backend Rules

The shared app layer must not assume all persistence backends behave the same.

- IndexedDB transaction timeout means untrusted persistence, not empty storage.
- Native single-file atomic writes do not imply multi-key transaction atomicity.
- Native `replaceKv`, `kvSet`, and `kvApplyMutations` must not run concurrently
  against the same store if they can reorder or undo each other.
- Platform-specific write failures must surface to the app as persistence
  failures that block normal writeback.

## Release Gate

A build that changes source data, persistence, import/export, cleanup, health,
or migration behavior is not releasable until it can demonstrate:

- no missing body/chunk/binary is written back as empty;
- no unloaded object is written back as empty;
- no stale catalog/index hides a complete orphan source record;
- no tombstoned object is recovered from stale sources;
- no cleanup failure rolls back a successful import;
- no single derived-data failure blocks source export;
- no backend timeout allows continued normal short-state persistence.

If any item is not demonstrable, the build may be used only for local diagnosis
or limited TestFlight/internal testing, not broad public release.

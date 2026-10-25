# Edge release recovery

Use the **Edge release status and publish** workflow from the repaired branch/main, with source
release tag `v2.1.1` for Helper 2.2.1. Do not rerun old run 39996521050: it executes the old script.
The publishing code and immutable source package are separate checkouts. No version bump is needed.

## Current incident

The source is `ad50c5e5712eea0a4662b6acdee11b1033de8a98`; Helper 2.2.1 ZIP SHA-256 is
`e53a5d75ab358d1e9c435f89e3ee83aef456bc6cc3ccfa9cd94ca384c2bd5050`.
Attempts 1, 33 and 38 uploaded that package, then failed with `InProgressSubmission`.
Helper 2.2.0 previously created submission `1152921505702165069` in run 39174800776.
This is a lead, not proof of which version is currently in review. No 2.2.1 submission or store
publication has been established by these logs.

## Reconcile before any write

There is no documented API that lists the current Edge review submission. Open
https://partner.microsoft.com/dashboard/microsoftedge/overview and inspect this product's
current review, draft and published versions. Do not cancel an existing review as a shortcut.
Use `status` first; it only reads the journal and resumes known operation GETs.

Use `reconcile` with fresh JSON evidence (within 30 minutes). The reference must be the actual
Partner Center page observed, with no credentials or session parameters. Do not copy these
examples as observations; replace their values with verified facts.

- `state: "in-review"`: `version` is the actual version in review. Include its `submissionId`
  to adopt a submission for the target version. An older version in review blocks the target.
- `state: "published"`: `version` must be the target, verified published in Partner Center.
  This marks it published and clears its product lock. It does not prove the remote ZIP digest;
  the journal digest identifies the local source package being tracked.
- `state: "clear"`: explicitly confirms **no submission in review or waiting to publish**, and
  that the target may replace the draft. `version` is the intended target version. Only then
  may `publish` upload it. Reconciliation itself never POSTs to Microsoft.

All evidence also needs `observedAt` (ISO date/time) and `reference` (Partner Center URL).
If another version is the active journal entry, reconcile that version to completion first.
A published target cannot be reset to clear for resubmission. Do not assert clear on the basis
of a failed GitHub run, an old operation result, or the absence of an `edge/*` tag.

After a genuine clear observation, run `publish` with the same source tag within 30 minutes.
If the clearance expires before a POST, obtain fresh evidence. The tags `edge/X.Y.Z` are legacy
receipts, not publication evidence; this workflow uses the journal instead and does not create them.
Manual dispatch never bypasses the journal.

## Durable state and recovery

The existing Actions token writes one file per product on branch `edge-release-state`:
`edge-release-state/<product-id>.json`. The branch is initialized only when a journal is first
written, and is not a release trigger. No Edge credentials are stored there. History is in Git.
The file SHA provides compare-and-swap; concurrent/stale writes stop, with no retry of the write.
All product writers must share the workflow concurrency group and this journal. Use Partner Center
only for observed reconciliation or deliberate manual recovery, since external manual changes
cannot be detected by an undocumented API.

Each Microsoft POST is preceded by a durable intent and followed immediately by a persisted
operation ID. Pending runs resume GETs of the same operation. A crash between the POST and saved
ID leaves intent/unknown and requires reconciliation. A failed journal write stops execution.
Missing/malformed state does not authorize an upload. Existing submitted/published versions
produce no POSTs; a different active version blocks all writes. Source/digest conflicts stop.

GETs use bounded exponential backoff with jitter and Retry-After. Exhaustion preserves pending.
POSTs are never automatically retried. Timeouts, uncertain server results, malformed Location,
unknown operation responses and lost receipts block automatic writes. `InProgressSubmission`
and `UnpublishInProgress` are blocked states, never success. Validation/authentication failures
need correction and reconciliation; do not invent a newer version to bypass them.

An upload success updates a draft. A submission POST's 202 means accepted for processing.
A submission operation's Succeeded means a submission was created, **not approved or published**.
Only version-specific Partner Center/store evidence justifies `published`. A green status or
reconcile run means that command completed, not that the extension is live. A publish run exits
with code 2 while blocked/pending/unknown and resumes safely on the next explicit invocation.

Official references:
- https://learn.microsoft.com/microsoft-edge/extensions/update/api/addons-api-reference
- https://learn.microsoft.com/microsoft-edge/extensions/publish/submission-states

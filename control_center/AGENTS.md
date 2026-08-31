# Anote Control Center Agent Instructions

## Required design path

Read [Control Center system design](../specs/control-center/control-center-system-design.md)
and [release, registry and checkpoint contract](../specs/control-center/release-checkpoint-contract.md)
completely before changing this directory.

## Lifecycle rules

- Keep the desktop program payload-free and bilingual. Docker Desktop is the
  only target prerequisite; do not invoke target Git, Node, Python, SQLite CLI,
  `rsync` or a registry.
- GUI widgets consume a service read model and request intent. They never
  interpret manifests, Docker output, registry JSON, readiness, compatibility,
  lineage or destructive-path policy.
- Lifecycle services accept only `VerifiedRelease`/`VerifiedCheckpoint` values,
  acquire the single operation lock and journal intent before external effects.
- Fresh setup, adoption, standby, retained reinstall, update, checkpoint,
  start/stop, safe uninstall and erase keep their distinct guards and
  postconditions. Every successful mutating setup/update/apply/reinstall result
  is stopped; only Orchestra starts production explicitly.
- Destructive paths are canonical registry-owned children. Reject symlinks,
  reparse points, traversal, broad roots, globs and discovery-only targets.
- Checkpoint verification opens the database and binds one owned package byte
  identity through apply. Session exclusion includes free-page/raw-byte and
  WAL/SHM remnants, not only logical rows; apply rechecks real Docker stopped
  state under the operation lock.
- Diagnostics redact secrets/content before bounding output. Worker threads
  never update Tk widgets directly.
- Generated runtime configuration owns host filesystem capability: macOS
  requires POSIX modes; Windows may reject only known unsupported `chmod`
  operations. Containers never infer this from their Linux process identity.
- Native packages and the Tk window use the repository-owned Anote calendar
  glyph through the deterministic icon generator. Windows taskbar process
  identity and the macOS Dock tile must be assigned explicitly; default
  Python/Tk runtime glyphs are not acceptable release output.

## Evidence and safety

Use deterministic fake adapters for ordering, failure injection and exhaustive
state/refusal evidence. Archive/path codecs get malicious input tests. Native
Docker/package/UI checks cover only risks those fakes cannot prove and must use
an isolated owned root, unique project/port and explicit ephemeral-destruction
acknowledgement. Never point any check at live Anote.

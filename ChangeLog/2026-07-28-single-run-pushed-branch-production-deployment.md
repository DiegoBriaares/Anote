# Single-run pushed-branch production deployment

Changed the compiled publish-and-deploy actions so a verified branch is deployed
immediately after it is committed, pushed, and represented by a draft pull
request. Merge is no longer a deployment prerequisite for these actions.

Added a pushed-release owner that fetches `origin`, requires local `HEAD` to
exactly equal `origin/<current-branch>`, and creates an isolated detached
worktree from that remote commit. It then delegates to the existing production
deployment, which builds unique images, creates an integrity-checked database
and uploads backup, preserves the active runtime configuration, performs the
health-checked Compose replacement, records the release, and rolls back on
failure. No Docker reset or manual data copy is used.

Direct `npm run prod:deploy` calls remain safe by default: clean releases target
`origin/main` unless the isolated pushed-release owner explicitly supplies a
different `origin/*` ref. This change does not alter application APIs or stored
data formats.

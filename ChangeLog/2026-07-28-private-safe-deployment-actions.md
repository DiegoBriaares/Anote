# Private-safe portable deployment actions

Updated the atomic deployment, changelog, conversation-recording, and GitHub
actions together with every compiled prompt that consumes them. Production
filesystem defaults now have one portable owner shared by backup, deploy, and
rollback scripts; production user operations target the managed data layout.

Removed personal paths, machine and tailnet identifiers, and development
uploads from the publishable repository state. Added explicit privacy gates to
the PR workflow, retained same-origin Anote production routing, and documented
the clean `main` → verified build → backup → health-checked cutover → rollback
contract. Production deployment remains blocked until the new PR is merged.

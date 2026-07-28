prompt: Update the deployment action, every compiled action prompt that includes it, and all related development scripts. Then execute the combined prompt-record, verification, and pull-request workflow for the Anote production architecture changes.

answer: Consolidated deployment path ownership, updated atomic and compiled action prompts, added privacy gates, verified the application, and prepared a new pull request workflow that stops before deployment while the PR is open.

suggestion: Merge the pull request before running the guarded production deployment command.

---

prompt: Ensure that no private data is exposed anywhere in the development project, including documentation.

answer: Replaced personal paths and network identifiers with portable configuration or placeholders, removed uploaded user data from the repository into a private recoverable archive, and added ignore and pre-publish privacy checks.

suggestion: Keep production environment files, databases, uploads, machine identifiers, and local overrides outside version control.

prompt: Wait, at <production-url> I do not see the expected changes in the production app. Is the deploy prompt actually deploying there, or does it need a Docker reset?

answer: Confirmed that production was healthy but still running the previous main commit because the compiled prompt intentionally stopped at an open draft pull request. Confirmed that Compose replacement already recreates the services and a Docker reset is unnecessary.

suggestion: Make the compiled action deploy the exact verified and pushed branch commit immediately after creating the pull request.

---

prompt: Remove the requirement that the pull request be merged. Running the compiled prompt should make the deployment take effect in production.

answer: Added an exact-pushed-commit deployment workflow that creates an isolated clean release checkout, preserves the existing backup and health-checked Compose cutover, and permits deployment while the draft pull request remains open.

suggestion: Use the compiled publish-and-deploy prompt for a single verification, publication, and production deployment run.

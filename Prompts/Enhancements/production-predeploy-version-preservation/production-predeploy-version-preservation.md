prompt: Make sure the currently running version is saved before production deployment. If it is not, fix it. Then run <repository-root>/Prompts/Actions/CompiledPrompts/FetchAndStorePromptsAndGlobalPushAndDeploy/Prompt.agcomp.

answer: Confirmed that deployment backs up the database, uploads, and active runtime environment before cutover, then closed a same-commit rollback gap by assigning every deployment a unique immutable image tag. Prepared the verified change for the prompt-directed pull request workflow, which does not deploy until after merge.

suggestion: Merge the pull request, fast-forward a clean local main to origin/main, and then run the guarded production deployment.

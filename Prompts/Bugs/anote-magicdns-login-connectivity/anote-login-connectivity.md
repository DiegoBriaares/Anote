prompt: Production Anote opens through its MagicDNS name, but login reports that it cannot reach a separately addressed API. Rearchitect development and production so the deployed application works reliably through one public address, preserve the existing production data, and update the release workflow.

answer: Replaced browser-derived API ports with same-origin `/api` routing, introduced a compiled gateway and private API container, migrated production state into managed storage, and added verified deployment and recovery tooling.

suggestion: Use the unified production address; do not expose or configure the internal API port in browsers.

---

prompt: Restart the local container runtime to recover its stalled host networking.

answer: Restarted the runtime after approval and verified that Anote, its private proxy, and the existing ERP services recovered.

suggestion: None.

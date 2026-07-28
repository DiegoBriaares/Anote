# Same-origin container production architecture

Replaced Anote's manually restarted Vite/API production copy with a compiled
Nginx gateway and internal Node 20 API. Browser requests now use same-origin
`/api` paths, production state and secrets live outside images, deployments
create verified backups and release manifests, and MagicDNS exposes only the
single application gateway. Added health checks, rollback tooling, isolated
container verification, and a one-command Node 20 development workflow.
Connection failures now use browser-locale English or Spanish recovery text
instead of exposing internal API ports to users. The release workflow verifies
under Node 20 and accepts routine deployments only from a clean local `main`
that exactly matches `origin/main`.

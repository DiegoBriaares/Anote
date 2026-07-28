prompt: Couldn't initiate: Last login: Mon Jan 12 02:29:21 on ttys000
cd <repository-root>/server && npm start
developer@workstation ~ % cd <repository-root>/server && npm start

> server@1.0.0 start
> node index.js

<repository-root>/server/node_modules/bindings/bindings.js:121
        throw e;
        ^

Error: dlopen(<repository-root>/server/node_modules/sqlite3/build/Release/node_sqlite3.node, 0x0001): tried: '<repository-root>/server/node_modules/sqlite3/build/Release/node_sqlite3.node' (code signature in <DFB61DC4-0D6B-3B10-BE39-1944935AB942> '<repository-root>/server/node_modules/sqlite3/build/Release/node_sqlite3.node' not valid for use in process: library load disallowed by system policy), '/System/Volumes/Preboot/Cryptexes/OS<repository-root>/server/node_modules/sqlite3/build/Release/node_sqlite3.node' (no such file), '<repository-root>/server/node_modules/sqlite3/build/Release/node_sqlite3.node' (code signature in <DFB61DC4-0D6B-3B10-BE39-1944935AB942> '<repository-root>/server/node_modules/sqlite3/build/Release/node_sqlite3.node' not valid for use in process: library load disallowed by system policy)
    at Object..node (node:internal/modules/cjs/loader:1919:18)
    at Module.load (node:internal/modules/cjs/loader:1480:32)
    at Module._load (node:internal/modules/cjs/loader:1299:12)
    at TracingChannel.traceSync (node:diagnostics_channel:328:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:245:24)
    at Module.require (node:internal/modules/cjs/loader:1503:12)
    at require (node:internal/modules/helpers:152:16)
    at bindings (<repository-root>/server/node_modules/bindings/bindings.js:112:48)
    at Object.<anonymous> (<repository-root>/server/node_modules/sqlite3/lib/sqlite3-binding.js:1:37)
    at Module._compile (node:internal/modules/cjs/loader:1760:14) {
  code: 'ERR_DLOPEN_FAILED'
}

Node.js v25.1.0

answer: Proposed rebuild and toolchain fixes for sqlite3.

suggestion: Switch to Node 20 LTS if you want to avoid native rebuild issues.

---

prompt: try 1

answer: Rebuilt sqlite3 from source.

suggestion: If rebuild fails, use Node 20 LTS.

---

prompt: do

answer: Installed setuptools and completed sqlite3 rebuild, then started the server.

suggestion: Tell me if you want to change the DB driver to avoid native builds.

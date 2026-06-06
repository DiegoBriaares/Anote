prompt: hey hey dev server typically runs in 5174 so fix!

answer: Stopped the mistaken Vite server on port 5173 and restarted the dev client on port 5174.

suggestion: Use 5174 for local client testing.

---

prompt: oh but the api is not running qhere it should, both are localhost and one used to be 3001 and 5174 the dev one, the prod one is 3000 and 5173 but we shall not use those ports

answer: Initially adjusted and started the API on 3001 while keeping the client on 5174.

suggestion: This was later corrected because 3001 is reserved for production.

---

prompt: Hey im sorry kill it and use 3002 :p

answer: Restored the dev API to port 3002 and cleared port 3001 for production.

suggestion: Keep local development on API 3002 and client 5174.

---

prompt: Reason is that I shall use 3001 for prod :p

answer: Confirmed the reason and kept the code defaults aligned with dev API 3002 and production API 3001.

suggestion: Do not use 3001 for local development.

---

prompt: Kill the server for now please

answer: Stopped both local dev processes on ports 3002 and 5174.

suggestion: Restart only when manual testing is needed.

---

prompt: restart them

answer: Restarted the API on 3002 and the Vite client on 5174.

suggestion: Use http://127.0.0.1:5174/ with API http://127.0.0.1:3002/.

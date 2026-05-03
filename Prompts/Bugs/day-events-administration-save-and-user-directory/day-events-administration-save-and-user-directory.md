prompt: At the very top there is a messsge Unable to load users. I could access the new Administration page, but when adding events the sections (admin, info, managemtnt) are not being populated with the new event, neither the calendar, the event just disappears after clicking add entry. Fix both issues

answer: Scoped user-directory load errors to the Friends page, aligned the default development API port to 3002, made event creation return explicit success/failure, kept create drafts on failed saves, surfaced action errors, and tightened the server `/events` insert response.

sugestion: Keep the API running on port 3002 during local testing so saves and user-directory calls hit the intended backend.

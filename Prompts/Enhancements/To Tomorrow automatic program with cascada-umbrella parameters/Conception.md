prompt: We will introduce the concept of automatic program into the calendar asa cascade-umbrella reaction on a parameter that is the to "tomorrow program parameter" which when set to true (boolean) the system automatically updates the calendar pages corresponding memory cells accordingly to the program for sending all except for the events marked as completed to tomorrow, i.e the "to tomorrow program").

answer: Added the To Tomorrow Program model, user-menu Programs dashboard, program persistence, automatic session-clock activation, and calendar event movement for incomplete events.

suggestion: Verify the target-day semantics before testing because the first implementation moved incomplete events from all dates.

---

prompt: In addition, we also introduce a new system to detect the real hour from time automatically from the session of the connected user according to somer previous request, or existing data. When a target time is hit, the to tomorrow program parameter automatically changes to true and the program is executed.

answer: Added a session-time checker that evaluates enabled programs while a user is logged in and activates the To Tomorrow Program at the configured HH:mm time.

suggestion: Keep the model tied to the connected browser session clock unless a server-side scheduler is later required.

---

prompt: Such thargeted time should be possible to set in a dashboard accesed thorugh the user section pages i.e the pages that drop down from the user icon at top, like Admin Condole for admins or profile, or friends. An input for the target time 00:00-23:59 should be presented in the corresponding user section. After saving, the protocols work so that when using the system at the target time hour then the current session is closed with the message Tomorrow program activated, to disable, please go to Programs section. Thats the new section called Programs where there is a table showing the programs with is activation time, with its is enable boolean, and with its name text, with its corresponding table crud operations admittable and the possibility to update the fields as described for input of tartget time but now in the crud operations.

answer: Added the Programs user-section page with a CRUD-style table for program name, activation time, enabled state, add/delete/save, and manual run; automatic activation logs out with the required message.

suggestion: Treat the table rows as To Tomorrow Program rows for now because only that program behavior is implemented.

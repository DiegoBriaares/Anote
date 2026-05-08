prompt: I said event but is day:Very good. Now we will solve a long-standsing bug. When mataining cliked and selecting more than one day, after
  dropping the click the page goes to a new page with only the backgroudn visible and nothing chargig. override this
  behavior if selecting multiple days by hovering and passing on various days contiinously leave them selected, unless
  another click happens again selecting other day or a any possible day selection without clicking mark days. anyway,
  please solve this bug make it no go to new page but stay and keep the days selected ;)

answer: Removed the auto-mounted multi-day range input surface from the calendar route so dragging across multiple days leaves the range highlighted on the calendar instead of opening the broken background-only flow.

sugestion: Drag across multiple calendar days locally and confirm the app stays on the calendar with the days selected.

---

prompt: ok let me test it locally first

answer: Paused before any GitHub work and left the multi-day selection fix available only in the local checkout for manual testing.

sugestion: Run the local dev servers and test the drag selection behavior before publishing.

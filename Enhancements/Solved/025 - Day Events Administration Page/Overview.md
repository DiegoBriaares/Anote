The Day Events Administration feature moves the selected-day administration workflow out of the calendar page and into a dedicated application view.

The calendar remains responsible for month navigation, date selection, and the double-click day modal. The day modal now provides a dedicated administration icon that opens the new page for the selected date. The page preserves the existing Day Events Administration, Day Events Information, and Day Events Management sections so event creation, editing, information/history review, range copy/move, and postponed-event transfer behavior continue to use the existing component contracts.

The implementation exposes a store-level navigation API for opening administration by date, keeps the selected administration date in a stable `yyyy-MM-dd` form for testing, and includes regression coverage for modal navigation and page rendering.

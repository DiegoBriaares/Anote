Missed Program Rollover and Flexible Move Targets

Implemented recovery for To Tomorrow programs that were missed while the app was not in use. Program checks now compare the last stored clock check to real current time, detect elapsed activations that have not run, and move incomplete events from the intended source day.

Added flexible target-date controls so selected calendar days can move incomplete events to a chosen date, and scheduled programs can define a target offset in days after the source day. Local development ports were also restored to client 5174 and API 3002, leaving API 3001 for production.

Refined the Programs screen so manual Run Now execution is visually separated from scheduled program definitions. Program definitions now keep daily activation semantics and use a Target Offset measured from the run date: 1 means tomorrow, 2 means pasado mañana, and so on.

prompt: When clicking log out it takes you to a blank screen (but with a squared background not plain white) instead of to the login page. However, the program functionality,when the time is hit, as expected, logs you out but that do take you to the login page. Fix the log out so the same happens after logging out.

answer: Fixed the manual logout path by preventing the React click event from being passed as a logout message and hardening logout state reset against non-string message arguments.

suggestion: No follow-up suggestion was needed; targeted store tests and the production build passed.

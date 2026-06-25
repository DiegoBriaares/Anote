Manual Logout Login Redirect

Fixed manual logout so it returns to the login page consistently. The Logout menu item now calls the logout action without forwarding the React click event, and the store only treats explicit string values as logout messages. This preserves the automatic program logout message behavior while preventing event objects from being rendered as login errors.

Added regression coverage for accidental non-message logout arguments and verified the fix with targeted store tests plus the production build.

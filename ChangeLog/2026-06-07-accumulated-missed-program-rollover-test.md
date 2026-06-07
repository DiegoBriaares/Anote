Accumulated Missed Program Rollover Test

Added focused regression coverage for the To Tomorrow scheduler when several activation days elapsed while the app was not in use. The test confirms that each missed run date moves its own incomplete events to run date plus Target Offset, preserving independent day targets instead of collapsing all events into one tomorrow date.

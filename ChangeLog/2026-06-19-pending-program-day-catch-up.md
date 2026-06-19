Pending Program Day Catch-Up

Fixed To Tomorrow automatic program recovery when the app is unused across multiple days. Enabled programs now seed the current day into a per-program pending-day queue, combine stored pending days with reconstructed elapsed activation days, move stale source days directly into the current day, and leave failed catch-up batches retryable by delaying scheduler clock updates until the full batch succeeds.

Added regression coverage for midnight seeding, stale pending-day recovery, closed-app day reconstruction, current-day target offsets, and partial failure retry behavior.

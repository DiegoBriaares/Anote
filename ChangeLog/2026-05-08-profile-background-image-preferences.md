# Profile Background Image Preferences

Fixed profile background image rendering for the account owner. The app now merges profile preferences with partial local appearance overrides, so a saved `backgroundUrl` is not hidden by locally cached theme or accent settings.

Saving profile preferences also refreshes the local appearance cache with the background image URL, and profile update requests now send only visual preferences in the preferences payload.

Validation:
- `npx vitest run src/App.test.ts src/store/calendarStore.profile.test.ts`
- `npm run build`
- `bash scripts/archive_prod_snapshot.sh` archived production to `/Users/digogonz/Desktop/Calendario/VersionesPasadas/29`
- `bash scripts/deploy_to_prod.sh`

Known check status:
- `npm run lint` still fails on pre-existing lint issues in server tests, admin/calendar components, and store typing/effect rules.

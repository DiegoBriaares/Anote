# App Shell

**Component anchor:** `src/App.tsx`

The **App Shell** is the authenticated frame around every primary page. It applies user theme preferences, renders the global identity controls, shows the configurable product banner, and decides which page is active from `currentView`.

## Page-Level Terms

- **Authenticated Frame**: The root layout shown after login.
- **Ambient Background**: The page background, user background image, overlay, and accent-driven visual treatment.
- **Active Page Slot**: The area where Calendar, Profile, Friends, Roles, Admin, Postponed, or Day Events Administration renders.
- **View State**: The `currentView` value that selects the active page.
- **Friend View State**: The `viewMode === 'friend'` state that makes calendar surfaces read-only.

## Components

- **Console Banner**: The global application title block.
- **User Menu**: The avatar-triggered account and navigation menu.

# FictionTale Changelog

## Version 1.6.0
Release date: 2026/11/27

### Changes made
- Polished the Stories library toolbar and reorganized Story Editor Planning into clear progress, quick-action, workspace, and secondary-option groups with responsive layouts.
- Refined the Story Editor writing layout and character @mentions for more reliable selection, focus, and responsive use.

## Version 1.5.3
Release date: 2026/11/26

### Changes made
- Standardized button hover, pressed, and keyboard-focus colors for both themes.

## Version 1.5.2
Release date: 2026/11/26

### Changes made
- Made the Places and World Entries preview actions easier to reach on mobile.
- Kept Cast Groups in their own full-width section on mobile.

### Fixed bugs
- Improved Install app visibility on touch devices and tablets.
- Refreshed the cached app shell so mobile browsers receive the latest layout.

## Version 1.5.1
Release date: 2026/11/26

### Changes made
- Request persistent browser storage after the first successful save and show its protection status in Data & Storage.
- Added higher-contrast keyboard focus indicators, forced-colors support, accessible names for editor controls, and a restrictive Content Security Policy.
- Added a prominent first-backup reminder and persistent, actionable save and backup failure alerts.
- Simplified workspace navigation by hiding empty counts, grouping advanced planning tools, and focusing the default writing view.

### Fixed bugs
- Fixed unsaved-change handling for Places and World Entries.
- Fixed saving and applying Accessibility preview settings.
- Prevented edits and resets from replacing markers for unavailable IndexedDB data.

### Known issues
- Story and project structure needs to be polished.

## Version 1.5.0
Release date: 2026/11/25

### Changes made
- Improved story preview and PDF text readability across customized page colors.
- Added project-specific Cast Groups with character assignment, drag-and-drop moves, reordering, and custom groups.
- Added backup history and clearer browser-storage warnings to Settings, with a live preview for accessibility preferences.
- Refreshed the sample projects and simplified tutorial guidance, including explanations of character questionnaires and timelines.
- Improved navigation counts across Writing, Characters, and Worldbuilding, including Cast and Cast Groups.

### Fixed bugs
- Fixed Cast Group editing and navigation behavior, including character counts and route announcements.
- Kept the current workspace section open after reload and improved destructive-button contrast in dark mode.

## Version 1.4.18
Release date: 2026/11/25

### Changes made
- Added direct DOCX and EPUB downloads to story previews and improved export formatting, metadata, and chapter navigation.

## Version 1.4.12.1
Release date: 2026/11/25

### Changes made
- Added install metadata, desktop and mobile screenshots, and app shortcuts for New story and My Projects.
- Wait for users to reload before applying service-worker updates and keep the active app shell version-consistent.
- Improved keyboard and screen-reader navigation between pages and workspace sections.
- Aligned the installed-app startup theme color with the light theme.
- Return the requested fallback when a browser storage read is blocked.

### Fixed bugs
- Prevent localStorage read errors from interrupting app rendering.

## Version 1.4.12
Release date: 2026/11/19

### Changes made
- Redesigned the Story editor around writing, with Writing and Planning modes, chapter navigation, references, and a dedicated planning panel.

### Fixed bugs
- Made the Story editor fill the desktop viewport and improved mobile toolbar and preview spacing.
- Kept the mobile save status fully readable and prevented the editor footer from overflowing horizontally.

## Version 1.4.11
Release date: 2026/11/19

### Changes made
- Moved Help & guides and Settings below the main navigation on desktop, with a modestly smaller utility style.

## Version 1.4.10
Release date: 2026/11/19

### Changes made
- Standardized release records with version, release date, changes, fixes, and known issues.

## Version 1.4.9
Release date: 2026/11/19

### Fixed bugs
- Improved readability of character descriptions over the colored profile header on mobile.

## Version 1.4.8
Release date: 2026/11/19

### Changes made
- Refreshed the offline app cache so existing installations receive updated scripts.

## Version 1.4.7
Release date: 2026/11/19

### Changes made
- Added Undo and expanded Recently Deleted to dialogue drafts and book series.
- Clarified restore and permanent-delete actions, and explained what backup imports replace.

## Version 1.4.6
Release date: 2026/11/19

### Changes made
- Added workspace breadcrumbs, clearer return paths, and sidebar access to Help & guides.

### Fixed bugs
- Kept the active navigation indicator aligned with nested sections such as Cast.

## Version 1.4.5
Release date: 2026/11/19

### Changes made
- Grouped character editing into essentials, depth, and advanced details; only the name is required.
- Collapsed optional details in place, world-entry, and story editors, and simplified planning with focused tabs.

### Fixed bugs
- Optional character lore no longer affects the completion score.

## Version 1.4.4
Release date: 2026/11/19

### Changes made
- Put project actions first on the landing page.
- Expanded backups to include every project, validate imports, and warn before replacing matching records.
- Added clearer saved, saving, and unsaved states plus a warning when browser data cannot load.

## Version 1.4.3
Release date: 2026/11/19

### Fixed bugs
- Fixed blank PDF output for character profiles, stories, places, and world entries.

## Version 1.4.0
Release date: 2026/11/17

### Changes made
- Added project file export and import for project details, stories, drafts, worldbuilding, and planning data. Imports create a separate project.
- Simplified project navigation, added an editable connected sample project, and updated the quick-start guide.
- Improved save and backup status indicators, including backup reminders.

### Fixed bugs
- Fixed PDF exports clipping character profiles, stories, places, and world entries.
- Successful save retries now clear the related error.
- Deleting the last project no longer recreates a starter project after reload.

## Version 1.1
Release date: 2026/11/11

### Changes made
- Added Dialogue Workshop for character-based conversations, emotional context, story insertion, and backup support.
- Added the Project Dashboard, per-story and draft word goals, Recently Deleted, and editor, writing, and accessibility settings.
- Added Book Series with book order, shared characters and places, cross-book timelines, and backup support.
- Restoring deleted shared characters and places now preserves their book-series links.

## Version 1.0
Release date: 2026/11/10

### Changes made
- Released FictionTale with Story Writing, Create Character, and Worldbuilding features.
- Added search, organization, writing goals, exports, backups, print options, light and dark themes, accessibility settings, and offline installation.

## Early Version 1.0
Release date: 2026/10/27

### Changes made
- Project Started

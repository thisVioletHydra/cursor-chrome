// Feature flags shared by the server (apps/hh, apps/web) and the extension.
// Pure module: no node imports, safe for the extension bundle.

// "Search hours" (search/apply only 9:00–22:00 Moscow). When false the window
// is never applied, whatever the saved per-user setting says (the setting is
// kept untouched, just ignored), and the UI block is hidden.
export const SEARCH_HOURS_ENABLED = false;

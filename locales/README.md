# Nucleus Localization (i18n)

Localization is a **Core service**, not an app. Apps only ship translation JSON;
Core discovers languages, resolves fallbacks + admin overrides, and exposes a
single `t()` API. Admins manage everything from the Admin Console → Localization.

## Adding translations to an app

1. Create `apps/<app>/locales/<lang>.json` — one file per language (BCP-47 tag,
   e.g. `en-US.json`, `cs-CZ.json`). Core strings live in `core/locales/`, Hub in
   `hub/locales/`.
2. Namespace every key with the scope: `<app>.*` (e.g. `photos.upload`), `core.*`
   for shared chrome. `en-US.json` is the base — its keys define the "complete"
   set every other language is measured against.
   ```json
   { "photos.title": "Photos", "photos.deleted": "{count} photos deleted." }
   ```
3. In the client, call `t()`:
   ```js
   import { useI18n } from '@core/useI18n.js'
   const { t } = useI18n()
   // template: {{ t('photos.title') }}   |   {{ t('photos.deleted', { count: 12 }) }}
   ```

That's it — no Core edits, no manual registration. The auth-server auto-discovers
the files (it scans `core/locales`, `hub/locales`, and `apps/*/locales`), and the
Admin Console shows the new language + its completeness.

## How it resolves (per key)

`admin override[lang]` → `file[lang]` → `admin override[en-US]` → `file[en-US]` →
the key itself. A missing translation never crashes the UI; it falls back to
English, then to the raw key.

## Concepts

- **Available** — a locale file ships on disk for that scope.
- **Installed** — activated in this instance (Admin → Localization). Installing ≠
  enabling; a language stays installed until explicitly removed. `en-US` is always
  installed.
- **Enabled** — turned on per scope (Core / each app). Runtime always falls back to
  English regardless, so an app keeps working even if it lacks a language.
- **Overrides** — admin edits stored in Mongo (not files), so they survive updates.
- **Per-user language** — assigned by an admin on the user's profile
  (Admin → Users). Users don't self-select by default.

## Notes

- Keys are global once namespaced, so an app's catalog includes `core.*` too —
  shared chrome (sidebar, header) is already translated for every app.
- Placeholders use `{name}` and are filled from the `t(key, params)` object.
- Designed to allow later pluralization / date-number-currency formatting / RTL
  without breaking this contract.

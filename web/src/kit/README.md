# Web kit

What every t10 web app shares: the API client, sign-in and sign-out, translations, browser
storage, the UI primitives and the stylesheet. An app holds a checked copy under `web/src/kit/`, made by
the workspace's `scripts/sync-modkit.sh`, and `make check` fails if one drifts. Change it
here. It holds no app's strings: each app passes its own catalog to `I18nProvider`.

`frame.tsx` is the frame every app draws: `Frame` (a hideable rail, a drawer on a phone),
`Rail` (the app's own sections, then the same Apps list everywhere) and `AccountMenu`
(tenants, language, theme, one Sign out). The Apps list is data, from manifests or the
auth service's homes, so no app names another in its code. Its strings, such as "Apps",
"Theme" and "Sign out", go in each app's catalog. An app's sections are data too: a
`NavSection` list from its `GET /v1/me/nav`, put in order by `groupSections`. An Apps entry
with `Sections` opens them under it, and `SectionLinks` draws another app's as links.

`command.tsx` is search and notifications in the same frame: `Palette` (⌘K, from
`useSearchShortcut` or `SearchButton`) shows what each app says it can reach, and `Bell`
lists unread notifications, each a link to where it happened, in whichever app sent it.

`ask.tsx` is the assistant in the same frame: `AskPanel`, inline in a page or as a panel
beside any page. It reaches the assistant only through the app's own `AskTransport`, so an
app that checks consent or removes identifiers before a turn leaves it keeps doing so.

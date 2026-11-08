# Web kit

What every t10 web app shares: the API client, sign-in and sign-out, translations, browser
storage, the UI primitives and the stylesheet. An app holds a checked copy under `web/src/kit/`, made by
the workspace's `scripts/sync-modkit.sh`, and `make check` fails if one drifts. Change it
here. It holds no app's strings: each app passes its own catalog to `I18nProvider`.

`frame.tsx` is the frame every app draws: `Frame` (a hideable rail, a drawer on a phone),
`Rail` (the app's own sections, then the same Apps list everywhere) and `AccountMenu`
(tenants, language, theme, one Sign out). The Apps list is data, from manifests or the
auth service's homes, so no app names another in its code. Its strings, such as "Apps",
"Theme" and "Sign out", go in each app's catalog.

# Web kit

What every t10 web app shares: the API client, sign-in and sign-out, translations, browser
storage, the UI primitives and the stylesheet. An app holds a checked copy under `web/src/kit/`, made by
the workspace's `scripts/sync-modkit.sh`, and `make check` fails if one drifts. Change it
here. It holds no app's strings: each app passes its own catalog to `I18nProvider`.

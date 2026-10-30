# supacharger-ext-transactional-email

![Supacharger Transactional Email Extension](gh-banner.webp)

Unified transactional email through Brevo API, Resend API, Mailgun API or authenticated SMTP. Core selects this extension as its service implementation; the developer-owned extension config selects one delivery transport.

Brevo uses hosted templates. Resend and Mailgun support hosted templates or rendered content. SMTP requires rendered subject and body. Each prepared worker imports only its selected adapter.

The private durable queue supports transaction-safe enqueue, eligibility rechecks, atomic leases, selected blocked recovery and conservative handling of ambiguous sends. Provider acceptance does not imply inbox delivery.

See [installation and API guidance](payload/docs/INSTALL.md) and [Bruno requests](payload/docs/bruno/). Run `npm install` and `npm run check` for source checks. Prepare an application with `node scripts/prepare.mjs /path/to/application <CLI-created-migration-filename>`; install its reviewed `.prepared/<code>` payload (`.prepared/default` for an empty code) using the CLI’s local extension installer. Release/archive metadata is separate from local package preparation.

Preparation reads only the host's `PROJECT_NAMESPACE` in `src/supacharger.config.ts`. Empty selects `sc_`; a 1–6 character code such as `wake` selects `sc_wake_`. SQL and workers are rendered before installation; no separate namespace setting is required.

## File ownership

The complete installable `extension.json` is generated at the prepared package root. `scripts/contract.mjs` maps every payload file to its destination and ownership; `npm run check` verifies source coverage and the contract boundaries. Preparation validates generated worker and migration entries before emitting the manifest and reads the release version from `package.json`.

Configuration is consumer-owned (`kind: "config"`), declarative SQL is extension-managed (`kind: "schema"`) and migrations are immutable (`kind: "migration"`). Other entries are extension-managed. Product customisations belong in application adapters. The source repository is not directly installable: use the reviewed prepared package.

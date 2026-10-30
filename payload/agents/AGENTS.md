# Transactional email integration

Select this installed extension through `CORE_SERVICES.transactional_email.provider` and configure one delivery provider in the developer-owned extension config. Preparation validates the project namespace, generates one static provider import, and records names and file mappings. Apply generated SQL and deploy explicitly; a frontend build performs no deployment.

Keep recipient eligibility, event queries and privacy logic in product-owned adapters. SQL callers use the private Core service binding within the business transaction. Server callers validate the common message schema before privileged enqueue. Never expose arbitrary mail submission to ordinary API clients.

Provider acceptance is not proof of receipt. Ambiguous sends and expired leases remain uncertain; do not replay them automatically. Repairable blocked jobs may be retried only for explicitly selected IDs after checking the cause. Keep secrets and message content out of logs. Preserve installed migration history and local config on update.

## File ownership

Read the incoming prepared package's `extension.json` before editing installed files. Its config entry is consumer-owned; ordinary source and guidance are extension-managed, `schema` entries are declarative SQL and `migration` entries are immutable history. Keep customisation in the config and application-owned adapters. Review direct-file update plans and Git diffs: replacement cannot distinguish local edits from upstream changes. No installed manifest receipt or per-file hash is maintained. Private extension-development instructions are for the Core development team, not consumer developers.

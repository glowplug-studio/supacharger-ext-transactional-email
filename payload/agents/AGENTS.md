# Transactional email integration

Select this installed extension through `CORE_SERVICES.transactional_email.provider` and configure one delivery provider in the developer-owned extension config. Preparation validates the project namespace, generates one static provider import, and records names and file mappings. Apply generated SQL and deploy explicitly; a frontend build performs no deployment.

Keep recipient eligibility, event queries and privacy logic in product-owned adapters. SQL callers use the private Core service binding within the business transaction. Server callers validate the common message schema before privileged enqueue. Never expose arbitrary mail submission to ordinary API clients.

Provider acceptance is not proof of receipt. Ambiguous sends and expired leases remain uncertain; do not replay them automatically. Repairable blocked jobs may be retried only for explicitly selected IDs after checking the cause. Keep secrets and message content out of logs. Preserve installed migration history and local config on update.

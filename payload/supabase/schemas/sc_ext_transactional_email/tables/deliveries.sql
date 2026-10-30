CREATE TABLE "sc_ext_transactional_email"."deliveries" (
  "delivery_id"        uuid                     NOT NULL,
  "message"            jsonb                    NOT NULL,
  "context"            jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "resolved_message"   jsonb,
  "provider"           text                     NOT NULL,
  "transport"          text                     NOT NULL,
  "status"             text                     NOT NULL DEFAULT 'queued'::text,
  "attempts"           integer                  NOT NULL DEFAULT 0,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "next_attempt_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token"        uuid,
  "claimed_until"      timestamp with time zone,
  "accepted_at"        timestamp with time zone,
  "reason"             text,
  "provider_reference" text,
  CONSTRAINT "deliveries_context_check" CHECK (((jsonb_typeof(context) = 'object'::text) AND (octet_length((context)::text) <= 16384))),
  CONSTRAINT "deliveries_pkey" PRIMARY KEY (delivery_id),
  CONSTRAINT "deliveries_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'claimed'::text, 'accepted'::text, 'blocked'::text, 'retryable'::text, 'uncertain'::text])))
);

ALTER TABLE "sc_ext_transactional_email"."deliveries"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX deliveries_pending ON sc_ext_transactional_email.deliveries USING btree (next_attempt_at, created_at)
  WHERE (status = ANY (ARRAY['queued'::text, 'retryable'::text]));

CREATE TRIGGER dispatch_inserted
  AFTER INSERT ON sc_ext_transactional_email.deliveries
  FOR EACH STATEMENT
  EXECUTE FUNCTION sc_ext_transactional_email.dispatch_inserted();

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "sc_ext_transactional_email"."deliveries" TO "postgres";

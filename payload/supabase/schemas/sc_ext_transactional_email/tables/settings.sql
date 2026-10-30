CREATE TABLE "sc_ext_transactional_email"."settings" (
  "setting_id" boolean NOT NULL DEFAULT true,
  "provider"   text    NOT NULL,
  "transport"  text    NOT NULL,
  "enabled"    boolean NOT NULL DEFAULT false,
  CONSTRAINT "settings_check"
    CHECK
    ((((((provider = 'brevo'::text) AND (transport = 'api'::text)) OR ((provider = 'resend'::text) AND (transport = 'api'::text))) OR ((provider = 'mailgun'::text) AND (transport =
    'api'::text))) OR ((provider = 'smtp'::text) AND (transport = 'smtp'::text)))),
  CONSTRAINT "settings_pkey" PRIMARY KEY (setting_id),
  CONSTRAINT "settings_setting_id_check" CHECK (setting_id)
);

ALTER TABLE "sc_ext_transactional_email"."settings"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "sc_ext_transactional_email"."settings" TO "postgres";

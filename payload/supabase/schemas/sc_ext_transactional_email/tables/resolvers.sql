CREATE TABLE "sc_ext_transactional_email"."resolvers" (
  "resolver_id"  uuid         NOT NULL DEFAULT gen_random_uuid(),
  "template_key" text         NOT NULL,
  "handler"      regprocedure NOT NULL,
  CONSTRAINT "resolvers_pkey" PRIMARY KEY (resolver_id),
  CONSTRAINT "resolvers_template_key_key" UNIQUE (template_key)
);

ALTER TABLE "sc_ext_transactional_email"."resolvers"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "sc_ext_transactional_email"."resolvers" TO "postgres";

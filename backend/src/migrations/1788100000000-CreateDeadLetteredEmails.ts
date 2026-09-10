import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeadLetteredEmails1788100000000
  implements MigrationInterface
{
  name = 'CreateDeadLetteredEmails1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."dead_letter_reason" AS ENUM('permanent', 'retries_exhausted')
    `);

    await queryRunner.query(`
      CREATE TABLE "dead_lettered_emails" (
        "id"              uuid                          NOT NULL DEFAULT uuid_generate_v4(),
        "message_id"      varchar(255)                  NOT NULL,
        "recipient"       varchar(320)                  NOT NULL,
        "subject"         varchar(500)                  NOT NULL,
        "body_html"       text                          NOT NULL,
        "body_text"       text                          NOT NULL,
        "user_address"    varchar(255),
        "reason"          "public"."dead_letter_reason" NOT NULL,
        "failure_message" varchar(1000)                 NOT NULL,
        "attempts"        integer                       NOT NULL,
        "queued_at"       timestamptz                   NOT NULL,
        "created_at"      timestamptz                   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dead_lettered_emails" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_dead_lettered_emails_message_id" ON "dead_lettered_emails" ("message_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_dead_lettered_emails_created_at" ON "dead_lettered_emails" ("created_at")
    `);

    // Supports the common triage query: "everything worth replaying, newest first".
    await queryRunner.query(`
      CREATE INDEX "IDX_dead_lettered_emails_reason_created_at" ON "dead_lettered_emails" ("reason", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_dead_lettered_emails_reason_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dead_lettered_emails_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dead_lettered_emails_message_id"`);
    await queryRunner.query(`DROP TABLE "dead_lettered_emails"`);
    await queryRunner.query(`DROP TYPE "public"."dead_letter_reason"`);
  }
}

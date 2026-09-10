import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Why a message stopped being retried.
 *
 * The distinction matters operationally: PERMANENT means the provider rejected
 * the message and resending it unchanged will fail again (a bad address, a
 * revoked key), while RETRIES_EXHAUSTED means the send never got a verdict and
 * is worth replaying once the provider is healthy.
 */
export enum DeadLetterReason {
  PERMANENT = 'permanent',
  RETRIES_EXHAUSTED = 'retries_exhausted',
}

/**
 * A notification email that will not be delivered.
 *
 * Before this table, `EmailService.processQueue` caught the delivery error,
 * logged one line, and dropped the message — it had already been shifted off
 * the in-memory queue, so nothing was left to inspect or replay.
 *
 * The rendered body is stored alongside the metadata so a message can be
 * replayed exactly as it was composed, without re-running template rendering
 * that may since have changed.
 */
@Entity('dead_lettered_emails')
@Index(['created_at'])
@Index(['reason', 'created_at'])
export class DeadLetteredEmail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The queue message id, so log lines can be tied back to this row. */
  @Index()
  @Column({ type: 'varchar', length: 255 })
  message_id: string;

  @Column({ type: 'varchar', length: 320 })
  recipient: string;

  @Column({ type: 'varchar', length: 500 })
  subject: string;

  @Column({ type: 'text' })
  body_html: string;

  @Column({ type: 'text' })
  body_text: string;

  /** Wallet address of the recipient when the message was addressed to a user. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  user_address: string | null;

  @Column({
    type: 'enum',
    enum: DeadLetterReason,
  })
  reason: DeadLetterReason;

  /** Message of the last error, kept short enough to scan in a list view. */
  @Column({ type: 'varchar', length: 1000 })
  failure_message: string;

  /** How many delivery attempts were made before giving up. */
  @Column({ type: 'integer' })
  attempts: number;

  /** When the message first entered the send queue. */
  @Column({ type: 'timestamptz' })
  queued_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

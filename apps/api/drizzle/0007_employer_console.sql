-- TetherProof: employer console.
--
-- Adds the two notification kinds an employer receives when a worker answers an
-- invitation. Written by hand like 0003–0006 and follows their house style.
--
-- PostgreSQL 12 and later permit ALTER TYPE ... ADD VALUE inside the transaction
-- the migrator wraps a file in, as long as the new label is not used in that
-- same transaction. Nothing here writes a row, so that rule holds, and the
-- application tolerates the labels being absent by treating a failed
-- notification as a courtesy that did not happen rather than a failed answer.
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'offer_accepted';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'offer_declined';

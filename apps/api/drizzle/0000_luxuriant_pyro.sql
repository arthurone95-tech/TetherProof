CREATE TYPE "public"."metadata_status" AS ENUM('pending', 'valid', 'flagged_ai_fake');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('worker', 'employer', 'training_provider', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verification_response" AS ENUM('none', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected', 'fraud_blocked');--> statement-breakpoint
CREATE TABLE "capability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"skill_tag" varchar(160) NOT NULL,
	"skill_level" integer DEFAULT 1 NOT NULL,
	"proof_count" integer DEFAULT 0 NOT NULL,
	"last_verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "direct_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employer_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"required_skill" varchar(160) NOT NULL,
	"min_proof_threshold" integer DEFAULT 1 NOT NULL,
	"max_distance_km" integer DEFAULT 25 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" varchar(160),
	"location_city" varchar(120),
	"location_gps" varchar(64),
	"organization_name" varchar(200),
	"avatar_url" varchar(512)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "user_role" DEFAULT 'worker' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_proof_id" uuid NOT NULL,
	"verifier_phone" varchar(32),
	"token_hash" varchar(64) NOT NULL,
	"response" "verification_response" DEFAULT 'none' NOT NULL,
	"verifier_gps" varchar(64),
	"fraud_score" real,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_proof_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"capability_block_id" uuid,
	"description" text NOT NULL,
	"media_url" varchar(512),
	"metadata_status" "metadata_status" DEFAULT 'pending' NOT NULL,
	"submission_gps" varchar(64),
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_blocks" ADD CONSTRAINT "capability_blocks_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_offers" ADD CONSTRAINT "direct_offers_employer_id_users_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_offers" ADD CONSTRAINT "direct_offers_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_specs" ADD CONSTRAINT "employer_specs_employer_id_users_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_work_proof_id_work_proof_logs_id_fk" FOREIGN KEY ("work_proof_id") REFERENCES "public"."work_proof_logs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_proof_logs" ADD CONSTRAINT "work_proof_logs_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_proof_logs" ADD CONSTRAINT "work_proof_logs_capability_block_id_capability_blocks_id_fk" FOREIGN KEY ("capability_block_id") REFERENCES "public"."capability_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_blocks_worker_id_idx" ON "capability_blocks" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "capability_blocks_skill_tag_idx" ON "capability_blocks" USING btree ("skill_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_blocks_worker_skill_unique" ON "capability_blocks" USING btree ("worker_id","skill_tag");--> statement-breakpoint
CREATE INDEX "direct_offers_employer_id_idx" ON "direct_offers" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "direct_offers_worker_id_idx" ON "direct_offers" USING btree ("worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_offers_employer_worker_unique" ON "direct_offers" USING btree ("employer_id","worker_id");--> statement-breakpoint
CREATE INDEX "employer_specs_employer_id_idx" ON "employer_specs" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "employer_specs_active_skill_idx" ON "employer_specs" USING btree ("is_active","required_skill");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_id_unique" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_token_hash_unique" ON "verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verifications_work_proof_id_idx" ON "verifications" USING btree ("work_proof_id");--> statement-breakpoint
CREATE INDEX "work_proof_logs_worker_id_idx" ON "work_proof_logs" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "work_proof_logs_verification_status_idx" ON "work_proof_logs" USING btree ("verification_status");
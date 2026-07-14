CREATE TABLE "MemberWarning" (
	"id" serial PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"memberId" text NOT NULL,
	"moderatorId" text,
	"reason" text NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "MemberWarning" ADD CONSTRAINT "MemberWarning_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "public"."Guild"("guildId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MemberWarning" ADD CONSTRAINT "MemberWarning_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."Member"("memberId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MemberWarning" ADD CONSTRAINT "MemberWarning_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "public"."Member"("memberId") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "MemberWarning_memberId_guildId_idx" ON "MemberWarning" USING btree ("memberId" text_ops,"guildId" text_ops);
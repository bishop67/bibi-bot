CREATE TABLE "ModLog" (
	"id" serial PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"action" text NOT NULL,
	"targetId" text NOT NULL,
	"moderatorId" text,
	"reason" text,
	"channelId" text,
	"logMessageId" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ModLog" ADD CONSTRAINT "ModLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "public"."Guild"("guildId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModLog" ADD CONSTRAINT "ModLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "public"."Member"("memberId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ModLog" ADD CONSTRAINT "ModLog_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "public"."Member"("memberId") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ModLog_guildId_createdAt_idx" ON "ModLog" USING btree ("guildId" text_ops,"createdAt" DESC NULLS LAST);
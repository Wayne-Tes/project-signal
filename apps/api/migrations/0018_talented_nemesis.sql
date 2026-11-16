ALTER TABLE "users" RENAME COLUMN "firebase_uid" TO "cognito_sub";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_firebase_uid_unique";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cognito_sub_unique" UNIQUE("cognito_sub");
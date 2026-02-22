import { relations } from "drizzle-orm";
import { boolean, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { server } from "./server";

export const cloudProviderType = pgEnum("cloudProviderType", [
	"hetzner",
	"digitalocean",
	"custom",
]);

export const cloudProvider = pgTable("cloud_provider", {
	cloudProviderId: text("cloudProviderId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	providerType: cloudProviderType("providerType").notNull(),
	// Encrypted at rest by the Go provisioner service (AES-256-GCM).
	// Node.js never stores or reads the plaintext token.
	encryptedApiToken: text("encryptedApiToken").notNull().default(""),
	isActive: boolean("isActive").notNull().default(true),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
});

export const cloudProviderRelations = relations(cloudProvider, ({ one, many }) => ({
	organization: one(organization, {
		fields: [cloudProvider.organizationId],
		references: [organization.id],
	}),
	servers: many(server),
}));

const createSchema = createInsertSchema(cloudProvider, {
	cloudProviderId: z.string().min(1),
	name: z.string().min(1),
});

export const apiCreateCloudProvider = createSchema
	.pick({
		name: true,
		providerType: true,
	})
	.required()
	.extend({
		apiToken: z.string().min(1),
	});

export const apiUpdateCloudProvider = createSchema
	.pick({
		cloudProviderId: true,
		name: true,
	})
	.required()
	.extend({
		apiToken: z.string().optional(),
	});

export const apiFindOneCloudProvider = createSchema
	.pick({ cloudProviderId: true })
	.required();

export const apiRemoveCloudProvider = createSchema
	.pick({ cloudProviderId: true })
	.required();

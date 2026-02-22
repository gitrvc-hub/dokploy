import { relations } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { applications } from "./application";
import { certificates } from "./certificate";
import { cloudProvider } from "./cloud-provider";
import { compose } from "./compose";
import { deployments } from "./deployment";
import { mariadb } from "./mariadb";
import { mongo } from "./mongo";
import { mysql } from "./mysql";
import { postgres } from "./postgres";
import { redis } from "./redis";
import { schedules } from "./schedule";
import { sshKeys } from "./ssh-key";
import { generateAppName } from "./utils";
export const serverStatus = pgEnum("serverStatus", ["active", "inactive"]);
export const serverType = pgEnum("serverType", ["deploy", "build"]);
export const provisionStatus = pgEnum("provisionStatus", [
	"pending",
	"provisioning",
	"provisioned",
	"failed",
	"destroying",
	"destroyed",
]);
export const serverRole = pgEnum("serverRole", ["master", "worker"]);

export const server = pgTable("server", {
	serverId: text("serverId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	description: text("description"),
	ipAddress: text("ipAddress").notNull(),
	port: integer("port").notNull(),
	username: text("username").notNull().default("root"),
	appName: text("appName")
		.notNull()
		.$defaultFn(() => generateAppName("server")),
	enableDockerCleanup: boolean("enableDockerCleanup").notNull().default(false),
	createdAt: text("createdAt").notNull(),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	serverStatus: serverStatus("serverStatus").notNull().default("active"),
	serverType: serverType("serverType").notNull().default("deploy"),
	command: text("command").notNull().default(""),
	sshKeyId: text("sshKeyId").references(() => sshKeys.sshKeyId, {
		onDelete: "set null",
	}),
	// Cloud provisioning fields (null for manually-added servers)
	cloudProviderId: text("cloudProviderId").references(
		() => cloudProvider.cloudProviderId,
		{ onDelete: "set null" },
	),
	region: text("region"),
	serverSize: text("serverSize"),
	osImage: text("osImage"),
	isBYOS: boolean("isBYOS").notNull().default(false),
	provisionStatus: provisionStatus("provisionStatus").default("provisioned"),
	providerServerId: text("providerServerId"),
	hostKeyFingerprint: text("hostKeyFingerprint"),
	// Encrypted by the Go provisioner (AES-256-GCM). Never read as plaintext in Node.js.
	encryptedKubeconfig: text("encryptedKubeconfig"),
	encryptedK3sToken: text("encryptedK3sToken"),
	k3sInstalled: boolean("k3sInstalled").notNull().default(false),
	serverRole: serverRole("serverRole").default("master"),
	masterServerId: text("masterServerId").references((): AnyPgColumn => server.serverId, {
		onDelete: "set null",
	}),
	metricsConfig: jsonb("metricsConfig")
		.$type<{
			server: {
				type: "Dokploy" | "Remote";
				refreshRate: number;
				port: number;
				token: string;
				urlCallback: string;
				retentionDays: number;
				cronJob: string;
				thresholds: {
					cpu: number;
					memory: number;
				};
			};
			containers: {
				refreshRate: number;
				services: {
					include: string[];
					exclude: string[];
				};
			};
		}>()
		.notNull()
		.default({
			server: {
				type: "Remote",
				refreshRate: 60,
				port: 4500,
				token: "",
				urlCallback: "",
				cronJob: "",
				retentionDays: 2,
				thresholds: {
					cpu: 0,
					memory: 0,
				},
			},
			containers: {
				refreshRate: 60,
				services: {
					include: [],
					exclude: [],
				},
			},
		}),
});

export const serverRelations = relations(server, ({ one, many }) => ({
	deployments: many(deployments, {
		relationName: "deploymentServer",
	}),
	buildDeployments: many(deployments, {
		relationName: "deploymentBuildServer",
	}),
	sshKey: one(sshKeys, {
		fields: [server.sshKeyId],
		references: [sshKeys.sshKeyId],
	}),
	cloudProvider: one(cloudProvider, {
		fields: [server.cloudProviderId],
		references: [cloudProvider.cloudProviderId],
	}),
	masterServer: one(server, {
		fields: [server.masterServerId],
		references: [server.serverId],
		relationName: "workerServers",
	}),
	workers: many(server, {
		relationName: "workerServers",
	}),
	applications: many(applications, {
		relationName: "applicationServer",
	}),
	buildApplications: many(applications, {
		relationName: "applicationBuildServer",
	}),
	compose: many(compose),
	redis: many(redis),
	mariadb: many(mariadb),
	mongo: many(mongo),
	mysql: many(mysql),
	postgres: many(postgres),
	certificates: many(certificates),
	organization: one(organization, {
		fields: [server.organizationId],
		references: [organization.id],
	}),
	schedules: many(schedules),
}));

const createSchema = createInsertSchema(server, {
	serverId: z.string().min(1),
	name: z.string().min(1),
	description: z.string().optional(),
});

export const apiCreateServer = createSchema
	.pick({
		name: true,
		description: true,
		ipAddress: true,
		port: true,
		username: true,
		sshKeyId: true,
		serverType: true,
	})
	.required();

export const apiCreateManagedServer = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	cloudProviderId: z.string().min(1),
	sshKeyId: z.string().min(1),
	region: z.string().min(1),
	serverSize: z.string().min(1),
	osImage: z.string().default("ubuntu-24.04"),
	serverType: z.enum(["deploy", "build"]).default("deploy"),
});

export const apiCreateBYOSServer = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	ipAddress: z.string().min(1),
	sshKeyId: z.string().min(1),
	serverType: z.enum(["deploy", "build"]).default("deploy"),
});

export const apiProvisionServer = z.object({
	serverId: z.string().min(1),
});

export const apiFindOneServer = createSchema
	.pick({
		serverId: true,
	})
	.required();

export const apiRemoveServer = createSchema
	.pick({
		serverId: true,
	})
	.required();

export const apiUpdateServer = createSchema
	.pick({
		name: true,
		description: true,
		serverId: true,
		ipAddress: true,
		port: true,
		username: true,
		sshKeyId: true,
		serverType: true,
	})
	.required()
	.extend({
		command: z.string().optional(),
	});

export const apiUpdateServerMonitoring = createSchema
	.pick({
		serverId: true,
	})
	.required()
	.extend({
		metricsConfig: z
			.object({
				server: z.object({
					refreshRate: z.number().min(2),
					port: z.number().min(1),
					token: z.string(),
					urlCallback: z.string().url(),
					retentionDays: z.number().min(1),
					cronJob: z.string().min(1),
					thresholds: z.object({
						cpu: z.number().min(0),
						memory: z.number().min(0),
					}),
				}),
				containers: z.object({
					refreshRate: z.number().min(2),
					services: z.object({
						include: z.array(z.string()).optional(),
						exclude: z.array(z.string()).optional(),
					}),
				}),
			})
			.required(),
	});

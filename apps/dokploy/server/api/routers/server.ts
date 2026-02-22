import {
	createServer,
	defaultCommand,
	deleteServer,
	findServerById,
	findServersByUserId,
	findUserById,
	getPublicIpWithFallback,
	haveActiveServices,
	IS_CLOUD,
	removeDeploymentsByServerId,
	serverAudit,
	serverSetup,
	serverValidate,
	setupMonitoring,
	updateServerById,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { and, desc, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { updateServersBasedOnQuantity } from "@/pages/api/stripe/webhook";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import {
	apiCreateBYOSServer,
	apiCreateManagedServer,
	apiCreateServer,
	apiFindOneServer,
	apiRemoveServer,
	apiUpdateServer,
	apiUpdateServerMonitoring,
	applications,
	compose,
	mariadb,
	mongo,
	mysql,
	organization,
	postgres,
	redis,
	server,
	sshKeys,
} from "@/server/db/schema";
import {
	provisionerFetch,
	type ProvisionerJobResponse,
	type ProvisionerJobStatus,
} from "@dokploy/server/utils/provisioner/client";

export const serverRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateServer)
		.mutation(async ({ ctx, input }) => {
			try {
				const user = await findUserById(ctx.user.ownerId);
				const servers = await findServersByUserId(user.id);
				if (IS_CLOUD && servers.length >= user.serversQuantity) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "You cannot create more servers",
					});
				}
				const project = await createServer(
					input,
					ctx.session.activeOrganizationId,
				);
				return project;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the server",
					cause: error,
				});
			}
		}),

	one: protectedProcedure
		.input(apiFindOneServer)
		.query(async ({ input, ctx }) => {
			const server = await findServerById(input.serverId);
			if (server.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this server",
				});
			}

			return server;
		}),
	getDefaultCommand: protectedProcedure
		.input(apiFindOneServer)
		.query(async ({ input }) => {
			const server = await findServerById(input.serverId);
			const isBuildServer = server.serverType === "build";
			return defaultCommand(isBuildServer);
		}),
	all: protectedProcedure.query(async ({ ctx }) => {
		const result = await db
			.select({
				...getTableColumns(server),
				totalSum: sql<number>`cast(count(${applications.applicationId}) + count(${compose.composeId}) + count(${redis.redisId}) + count(${mariadb.mariadbId}) + count(${mongo.mongoId}) + count(${mysql.mysqlId}) + count(${postgres.postgresId}) as integer)`,
			})
			.from(server)
			.leftJoin(applications, eq(applications.serverId, server.serverId))
			.leftJoin(compose, eq(compose.serverId, server.serverId))
			.leftJoin(redis, eq(redis.serverId, server.serverId))
			.leftJoin(mariadb, eq(mariadb.serverId, server.serverId))
			.leftJoin(mongo, eq(mongo.serverId, server.serverId))
			.leftJoin(mysql, eq(mysql.serverId, server.serverId))
			.leftJoin(postgres, eq(postgres.serverId, server.serverId))
			.where(eq(server.organizationId, ctx.session.activeOrganizationId))
			.orderBy(desc(server.createdAt))
			.groupBy(server.serverId);

		return result;
	}),
	count: protectedProcedure.query(async ({ ctx }) => {
		const organizations = await db.query.organization.findMany({
			where: eq(organization.ownerId, ctx.user.id),
			with: {
				servers: true,
			},
		});

		const servers = organizations.flatMap((org) => org.servers);

		return servers.length ?? 0;
	}),
	withSSHKey: protectedProcedure.query(async ({ ctx }) => {
		const result = await db.query.server.findMany({
			orderBy: desc(server.createdAt),
			where: IS_CLOUD
				? and(
						isNotNull(server.sshKeyId),
						eq(server.organizationId, ctx.session.activeOrganizationId),
						eq(server.serverStatus, "active"),
						eq(server.serverType, "deploy"),
					)
				: and(
						isNotNull(server.sshKeyId),
						eq(server.organizationId, ctx.session.activeOrganizationId),
						eq(server.serverType, "deploy"),
					),
		});
		return result;
	}),
	buildServers: protectedProcedure.query(async ({ ctx }) => {
		const result = await db.query.server.findMany({
			orderBy: desc(server.createdAt),
			where: IS_CLOUD
				? and(
						isNotNull(server.sshKeyId),
						eq(server.organizationId, ctx.session.activeOrganizationId),
						eq(server.serverStatus, "active"),
						eq(server.serverType, "build"),
					)
				: and(
						isNotNull(server.sshKeyId),
						eq(server.organizationId, ctx.session.activeOrganizationId),
						eq(server.serverType, "build"),
					),
		});
		return result;
	}),
	setup: protectedProcedure
		.input(apiFindOneServer)
		.mutation(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to setup this server",
					});
				}
				const currentServer = await serverSetup(input.serverId);
				return currentServer;
			} catch (error) {
				throw error;
			}
		}),
	setupWithLogs: protectedProcedure
		.meta({
			openapi: {
				path: "/deploy/server-with-logs",
				method: "POST",
				override: true,
				enabled: false,
			},
		})
		.input(apiFindOneServer)
		.subscription(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to setup this server",
					});
				}
				return observable<string>((emit) => {
					serverSetup(input.serverId, (log) => {
						emit.next(log);
					});
				});
			} catch (error) {
				throw error;
			}
		}),
	validate: protectedProcedure
		.input(apiFindOneServer)
		.query(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to validate this server",
					});
				}
				const response = await serverValidate(input.serverId);
				return response as unknown as {
					docker: {
						enabled: boolean;
						version: string;
					};
					rclone: {
						enabled: boolean;
						version: string;
					};
					nixpacks: {
						enabled: boolean;
						version: string;
					};
					buildpacks: {
						enabled: boolean;
						version: string;
					};
					railpack: {
						enabled: boolean;
						version: string;
					};
					isDokployNetworkInstalled: boolean;
					isSwarmInstalled: boolean;
					isMainDirectoryInstalled: boolean;
				};
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error?.message : `Error: ${error}`,
					cause: error as Error,
				});
			}
		}),

	security: protectedProcedure
		.input(apiFindOneServer)
		.query(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to validate this server",
					});
				}
				const response = await serverAudit(input.serverId);
				return response as unknown as {
					ufw: {
						installed: boolean;
						active: boolean;
						defaultIncoming: string;
					};
					ssh: {
						enabled: boolean;
						keyAuth: boolean;
						permitRootLogin: string;
						passwordAuth: string;
						usePam: string;
					};
					nonRootUser: {
						hasValidSudoUser: boolean;
					};
					unattendedUpgrades: {
						installed: boolean;
						active: boolean;
						updateEnabled: number;
						upgradeEnabled: number;
					};
					fail2ban: {
						installed: boolean;
						enabled: boolean;
						active: boolean;
						sshEnabled: string;
						sshMode: string;
					};
				};
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error?.message : `Error: ${error}`,
					cause: error as Error,
				});
			}
		}),
	setupMonitoring: protectedProcedure
		.input(apiUpdateServerMonitoring)
		.mutation(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to setup this server",
					});
				}

				await updateServerById(input.serverId, {
					metricsConfig: {
						server: {
							type: "Remote",
							refreshRate: input.metricsConfig.server.refreshRate,
							retentionDays: input.metricsConfig.server.retentionDays,
							port: input.metricsConfig.server.port,
							token: input.metricsConfig.server.token,
							urlCallback: input.metricsConfig.server.urlCallback,
							cronJob: input.metricsConfig.server.cronJob,
							thresholds: {
								cpu: input.metricsConfig.server.thresholds.cpu,
								memory: input.metricsConfig.server.thresholds.memory,
							},
						},
						containers: {
							refreshRate: input.metricsConfig.containers.refreshRate,
							services: {
								include: input.metricsConfig.containers.services.include || [],
								exclude: input.metricsConfig.containers.services.exclude || [],
							},
						},
					},
				});
				const currentServer = await setupMonitoring(input.serverId);
				return currentServer;
			} catch (error) {
				throw error;
			}
		}),
	remove: protectedProcedure
		.input(apiRemoveServer)
		.mutation(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to delete this server",
					});
				}
				const activeServers = await haveActiveServices(input.serverId);

				if (activeServers) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Server has active services, please delete them first",
					});
				}
				const currentServer = await findServerById(input.serverId);
				await removeDeploymentsByServerId(currentServer);
				await deleteServer(input.serverId);

				if (IS_CLOUD) {
					const admin = await findUserById(ctx.user.ownerId);

					await updateServersBasedOnQuantity(admin.id, admin.serversQuantity);
				}

				return currentServer;
			} catch (error) {
				throw error;
			}
		}),
	update: protectedProcedure
		.input(apiUpdateServer)
		.mutation(async ({ input, ctx }) => {
			try {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to update this server",
					});
				}

				if (server.serverStatus === "inactive") {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Server is inactive",
					});
				}
				const currentServer = await updateServerById(input.serverId, {
					...input,
				});

				return currentServer;
			} catch (error) {
				throw error;
			}
		}),
	publicIp: protectedProcedure.query(async () => {
		if (IS_CLOUD) {
			return "";
		}
		const ip = await getPublicIpWithFallback();
		return ip;
	}),
	getServerTime: protectedProcedure.query(() => {
		if (IS_CLOUD) {
			return null;
		}
		return {
			time: new Date(),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	}),
	// ─── Cloud Provisioning ───────────────────────────────────────────────────

	createManaged: protectedProcedure
		.input(apiCreateManagedServer)
		.mutation(async ({ ctx, input }) => {
			const newServer = await db
				.insert(server)
				.values({
					name: input.name,
					description: input.description,
					ipAddress: "",
					port: 22,
					username: "root",
					organizationId: ctx.session.activeOrganizationId,
					createdAt: new Date().toISOString(),
					cloudProviderId: input.cloudProviderId,
					sshKeyId: input.sshKeyId,
					region: input.region,
					serverSize: input.serverSize,
					osImage: input.osImage,
					serverType: input.serverType,
					provisionStatus: "pending",
					isBYOS: false,
				})
				.returning()
				.then((v) => v[0]);

			if (!newServer) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Error creating server" });
			}
			return newServer;
		}),

	createBYOS: protectedProcedure
		.input(apiCreateBYOSServer)
		.mutation(async ({ ctx, input }) => {
			const newServer = await db
				.insert(server)
				.values({
					name: input.name,
					description: input.description,
					ipAddress: input.ipAddress,
					port: 22,
					username: "root",
					organizationId: ctx.session.activeOrganizationId,
					createdAt: new Date().toISOString(),
					sshKeyId: input.sshKeyId,
					serverType: input.serverType,
					provisionStatus: "pending",
					isBYOS: true,
				})
				.returning()
				.then((v) => v[0]);

			if (!newServer) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Error creating BYOS server" });
			}
			return newServer;
		}),

	provision: protectedProcedure
		.input(z.object({ serverId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const srv = await findServerById(input.serverId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			// Resolve SSH public key server-side
			let sshPublicKey = "";
			if (srv.sshKeyId) {
				const sshKeyRecord = await db.query.sshKeys.findFirst({
					where: (k, { eq }) => eq(k.sshKeyId, srv.sshKeyId!),
				});
				sshPublicKey = sshKeyRecord?.publicKey ?? "";
			}
			return provisionerFetch<ProvisionerJobResponse>(
				`/servers/${input.serverId}/provision`,
				{ method: "POST", body: JSON.stringify({ sshPublicKey }) },
			);
		}),

	installK3s: protectedProcedure
		.input(z.object({ serverId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const srv = await findServerById(input.serverId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return provisionerFetch<ProvisionerJobResponse>(
				`/servers/${input.serverId}/install-k3s`,
				{ method: "POST" },
			);
		}),

	byosSetup: protectedProcedure
		.input(z.object({ serverId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const srv = await findServerById(input.serverId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return provisionerFetch<ProvisionerJobResponse>(
				`/servers/${input.serverId}/byos-setup`,
				{ method: "POST" },
			);
		}),

	destroyServer: protectedProcedure
		.input(z.object({ serverId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const srv = await findServerById(input.serverId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return provisionerFetch<ProvisionerJobResponse>(
				`/servers/${input.serverId}/destroy`,
				{ method: "POST" },
			);
		}),

	provisionStatus: protectedProcedure
		.input(z.object({ serverId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const srv = await findServerById(input.serverId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return {
				provisionStatus: srv.provisionStatus,
				k3sInstalled: srv.k3sInstalled,
				ipAddress: srv.ipAddress,
			};
		}),

	watchJobLogs: protectedProcedure
		.input(z.object({ jobId: z.string().min(1) }))
		.subscription(async ({ input, ctx }) => {
			// Ownership check: verify the job belongs to a server owned by this org
			const jobRows = await db.execute<{ serverId: string }>(
				sql`SELECT "serverId" FROM "provisioner_job" WHERE "jobId" = ${input.jobId}`,
			);
			if (jobRows.length === 0) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
			}
			const jobServerId = jobRows[0]!.serverId;
			const srv = await findServerById(jobServerId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authorized to view this job" });
			}
			return observable<string>((emit) => {
				// Fetch existing logs immediately, then stream new ones via SSE.
				const url = `${process.env.PROVISIONER_URL ?? "http://provisioner:4600"}/jobs/${input.jobId}/stream`;
				const apiKey = process.env.PROVISIONER_API_KEY ?? "";

				const controller = new AbortController();
				fetch(url, {
					headers: { "X-API-Key": apiKey },
					signal: controller.signal,
				})
					.then(async (res) => {
						if (!res.body) {
							emit.complete();
							return;
						}
						const reader = res.body.getReader();
						const decoder = new TextDecoder();
						let buffer = "";
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							buffer += decoder.decode(value, { stream: true });
							const lines = buffer.split("\n");
							buffer = lines.pop() ?? "";
							for (const line of lines) {
								if (line.startsWith("data: ")) {
									const data = line.slice(6).trim();
									if (data === "[DONE]") {
										emit.complete();
										return;
									}
									emit.next(data);
								}
							}
						}
						emit.complete();
					})
					.catch((err) => {
						if (err.name !== "AbortError") {
							emit.error(err);
						}
					});

				return () => controller.abort();
			});
		}),

	getJobStatus: protectedProcedure
		.input(z.object({ jobId: z.string().min(1) }))
		.query(async ({ input, ctx }) => {
			// Ownership check
			const jobRows = await db.execute<{ serverId: string }>(
				sql`SELECT "serverId" FROM "provisioner_job" WHERE "jobId" = ${input.jobId}`,
			);
			if (jobRows.length === 0) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
			}
			const jobServerId = jobRows[0]!.serverId;
			const srv = await findServerById(jobServerId);
			if (srv.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authorized to view this job" });
			}
			return provisionerFetch<ProvisionerJobStatus>(`/jobs/${input.jobId}`);
		}),

	getServerMetrics: protectedProcedure
		.input(
			z.object({
				url: z.string(),
				token: z.string(),
				dataPoints: z.string(),
			}),
		)
		.query(async ({ input }) => {
			try {
				const url = new URL(input.url);
				url.searchParams.append("limit", input.dataPoints);
				const response = await fetch(url.toString(), {
					headers: {
						Authorization: `Bearer ${input.token}`,
					},
				});
				if (!response.ok) {
					throw new Error(
						`Error ${response.status}: ${response.statusText}. Ensure the container is running and this service is included in the monitoring configuration.`,
					);
				}

				const data = await response.json();
				if (!Array.isArray(data) || data.length === 0) {
					throw new Error(
						[
							"No monitoring data available. This could be because:",
							"",
							"1. You don't have setup the monitoring service, you can do in web server section.",
							"2. If you already have setup the monitoring service, wait a few minutes and refresh the page.",
						].join("\n"),
					);
				}
				return data as {
					cpu: string;
					cpuModel: string;
					cpuCores: number;
					cpuPhysicalCores: number;
					cpuSpeed: number;
					os: string;
					distro: string;
					kernel: string;
					arch: string;
					memUsed: string;
					memUsedGB: string;
					memTotal: string;
					uptime: number;
					diskUsed: string;
					totalDisk: string;
					networkIn: string;
					networkOut: string;
					timestamp: string;
				}[];
			} catch (error) {
				throw error;
			}
		}),
});

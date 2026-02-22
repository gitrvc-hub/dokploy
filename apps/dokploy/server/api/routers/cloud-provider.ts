import {
	createCloudProvider,
	deleteCloudProvider,
	findCloudProviderById,
	findCloudProvidersByOrgId,
	updateCloudProvider,
} from "@dokploy/server";
import {
	apiCreateCloudProvider,
	apiFindOneCloudProvider,
	apiRemoveCloudProvider,
	apiUpdateCloudProvider,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import {
	provisionerFetch,
	type ProvisionerRegion,
	type ProvisionerServerSize,
} from "@dokploy/server/utils/provisioner/client";

export const cloudProviderRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateCloudProvider)
		.mutation(async ({ ctx, input }) => {
			try {
				return await createCloudProvider(
					input,
					ctx.session.activeOrganizationId,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error ? error.message : "Error creating provider",
				});
			}
		}),

	all: protectedProcedure.query(async ({ ctx }) => {
		return findCloudProvidersByOrgId(ctx.session.activeOrganizationId);
	}),

	one: protectedProcedure
		.input(apiFindOneCloudProvider)
		.query(async ({ ctx, input }) => {
			const provider = await findCloudProviderById(input.cloudProviderId);
			if (provider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return provider;
		}),

	update: protectedProcedure
		.input(apiUpdateCloudProvider)
		.mutation(async ({ ctx, input }) => {
			const provider = await findCloudProviderById(input.cloudProviderId);
			if (provider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return updateCloudProvider(input);
		}),

	remove: protectedProcedure
		.input(apiRemoveCloudProvider)
		.mutation(async ({ ctx, input }) => {
			const provider = await findCloudProviderById(input.cloudProviderId);
			if (provider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			await deleteCloudProvider(input.cloudProviderId);
			return { success: true };
		}),

	testConnection: protectedProcedure
		.input(apiFindOneCloudProvider)
		.mutation(async ({ ctx, input }) => {
			const provider = await findCloudProviderById(input.cloudProviderId);
			if (provider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return provisionerFetch<{ valid: boolean }>(
				`/providers/${input.cloudProviderId}/test`,
				{ method: "POST" },
			);
		}),

	listRegions: protectedProcedure
		.input(apiFindOneCloudProvider)
		.query(async ({ ctx, input }) => {
			const provider = await findCloudProviderById(input.cloudProviderId);
			if (provider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return provisionerFetch<ProvisionerRegion[]>(
				`/providers/${input.cloudProviderId}/regions`,
			);
		}),

	listSizes: protectedProcedure
		.input(
			z.object({
				cloudProviderId: z.string().min(1),
				region: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const provider = await findCloudProviderById(input.cloudProviderId);
			if (provider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			const query = input.region ? `?region=${input.region}` : "";
			return provisionerFetch<ProvisionerServerSize[]>(
				`/providers/${input.cloudProviderId}/sizes${query}`,
			);
		}),
});

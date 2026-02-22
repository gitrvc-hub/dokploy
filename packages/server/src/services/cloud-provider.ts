import { db } from "@dokploy/server/db";
import {
	type apiCreateCloudProvider,
	type apiUpdateCloudProvider,
	cloudProvider,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { provisionerFetch } from "../utils/provisioner/client";

export type CloudProvider = typeof cloudProvider.$inferSelect;

export const createCloudProvider = async (
	input: typeof apiCreateCloudProvider._type,
	organizationId: string,
): Promise<CloudProvider> => {
	// Ask the Go provisioner to encrypt the API token before we store it.
	const { encryptedToken } = await provisionerFetch<{ encryptedToken: string }>(
		"/providers/encrypt-token",
		{
			method: "POST",
			body: JSON.stringify({ token: input.apiToken }),
		},
	);

	const result = await db
		.insert(cloudProvider)
		.values({
			name: input.name,
			providerType: input.providerType,
			encryptedApiToken: encryptedToken,
			organizationId,
			createdAt: new Date().toISOString(),
		})
		.returning()
		.then((v) => v[0]);

	if (!result) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error creating cloud provider",
		});
	}
	return result;
};

export const findCloudProviderById = async (
	cloudProviderId: string,
): Promise<CloudProvider> => {
	const result = await db.query.cloudProvider.findFirst({
		where: eq(cloudProvider.cloudProviderId, cloudProviderId),
	});
	if (!result) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Cloud provider not found",
		});
	}
	return result;
};

export const findCloudProvidersByOrgId = async (
	organizationId: string,
): Promise<CloudProvider[]> => {
	return db.query.cloudProvider.findMany({
		where: eq(cloudProvider.organizationId, organizationId),
	});
};

export const updateCloudProvider = async (
	input: typeof apiUpdateCloudProvider._type,
): Promise<CloudProvider> => {
	const updates: Partial<CloudProvider> = { name: input.name };

	if (input.apiToken) {
		const { encryptedToken } = await provisionerFetch<{ encryptedToken: string }>(
			"/providers/encrypt-token",
			{
				method: "POST",
				body: JSON.stringify({ token: input.apiToken }),
			},
		);
		updates.encryptedApiToken = encryptedToken;
	}

	const result = await db
		.update(cloudProvider)
		.set(updates)
		.where(eq(cloudProvider.cloudProviderId, input.cloudProviderId))
		.returning()
		.then((v) => v[0]);

	if (!result) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Cloud provider not found",
		});
	}
	return result;
};

export const deleteCloudProvider = async (
	cloudProviderId: string,
): Promise<void> => {
	await db
		.delete(cloudProvider)
		.where(eq(cloudProvider.cloudProviderId, cloudProviderId));
};

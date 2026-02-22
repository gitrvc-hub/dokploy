import { TRPCError } from "@trpc/server";

const PROVISIONER_URL =
	process.env.PROVISIONER_URL ?? "http://provisioner:4600";
const PROVISIONER_API_KEY = process.env.PROVISIONER_API_KEY ?? "";

/**
 * HTTP client for communicating with the Go provisioner microservice.
 * All requests include the shared API key for authentication.
 */
export const provisionerFetch = async <T = unknown>(
	path: string,
	options?: RequestInit,
): Promise<T> => {
	const res = await fetch(`${PROVISIONER_URL}${path}`, {
		...options,
		headers: {
			"X-API-Key": PROVISIONER_API_KEY,
			"Content-Type": "application/json",
			...(options?.headers ?? {}),
		},
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "unknown error");
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Provisioner error (${res.status}): ${text}`,
		});
	}

	return res.json() as Promise<T>;
};

export type ProvisionerJobResponse = {
	jobId: string;
};

export type ProvisionerJobStatus = {
	jobId: string;
	status: "pending" | "running" | "done" | "error";
	lines: string[];
};

export type ProvisionerRegion = {
	id: string;
	name: string;
};

export type ProvisionerServerSize = {
	id: string;
	name: string;
	cpus: number;
	memory_gb: number;
	disk_gb: number;
	price_monthly: string;
};

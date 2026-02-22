import { Cloud, Loader2, MoreHorizontal, Plug, ServerIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/utils/api";
import { HandleCloudProvider } from "./handle-cloud-provider";
import { CreateBYOSServer } from "../servers/create-byos-server";
import { CreateManagedServer } from "../servers/create-managed-server";
import { CreateWorkerServer } from "../servers/create-worker-server";

const PROVIDER_LABELS: Record<string, string> = {
	hetzner: "Hetzner",
	digitalocean: "DigitalOcean",
	custom: "Custom / BYOS",
};

const PROVIDER_COLORS: Record<string, string> = {
	hetzner: "bg-red-500/10 text-red-400 border-red-500/20",
	digitalocean: "bg-blue-500/10 text-blue-400 border-blue-500/20",
	custom: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export const ShowCloudProviders = () => {
	const { data: providers, refetch, isLoading } = api.cloudProvider.all.useQuery();
	const { mutateAsync: remove } = api.cloudProvider.remove.useMutation();
	const { mutateAsync: testConnection, isPending: isTesting } =
		api.cloudProvider.testConnection.useMutation();

	const handleRemove = async (cloudProviderId: string) => {
		try {
			await remove({ cloudProviderId });
			toast.success("Cloud provider removed");
			refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error removing provider");
		}
	};

	return (
		<div className="flex flex-col gap-4 w-full">
			<Card className="bg-background">
				<CardHeader>
					<CardTitle className="text-xl flex items-center gap-2">
						<Cloud className="size-5" />
						Cloud Providers
					</CardTitle>
					<CardDescription>
						Connect your cloud accounts to provision servers automatically via
						Terraform.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="animate-spin size-6 text-muted-foreground" />
						</div>
					) : !providers?.length ? (
						<div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
							<ServerIcon className="size-8" />
							<p className="text-sm">No cloud providers configured yet.</p>
						</div>
					) : (
						<div className="grid gap-3">
							{providers.map((provider) => (
								<div
									key={provider.cloudProviderId}
									className="flex items-center justify-between rounded-lg border p-4"
								>
									<div className="flex items-center gap-3">
										<div className="flex flex-col gap-1">
											<span className="font-medium text-sm">{provider.name}</span>
											<Badge
												variant="outline"
												className={`text-xs w-fit ${PROVIDER_COLORS[provider.providerType] ?? ""}`}
											>
												{PROVIDER_LABELS[provider.providerType] ?? provider.providerType}
											</Badge>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Badge
											variant="outline"
											className={
												provider.isActive
													? "border-green-500/20 text-green-400"
													: "border-red-500/20 text-red-400"
											}
										>
											{provider.isActive ? "Active" : "Inactive"}
										</Badge>
										<CreateManagedServer cloudProviderId={provider.cloudProviderId} />
										<CreateWorkerServer cloudProviderId={provider.cloudProviderId} />
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="size-8">
													<MoreHorizontal className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuLabel>Actions</DropdownMenuLabel>
												<button
													type="button"
													className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent outline-none"
													disabled={isTesting}
													onClick={async () => {
														try {
															await testConnection({ cloudProviderId: provider.cloudProviderId });
															toast.success("Connection successful");
														} catch (err) {
															toast.error(err instanceof Error ? err.message : "Connection failed");
														}
													}}
												>
													<Plug className="size-4 mr-2" />
													{isTesting ? "Testing..." : "Test Connection"}
												</button>
												<HandleCloudProvider
													cloudProviderId={provider.cloudProviderId}
													onSuccess={refetch}
												/>
												<DialogAction
													title="Remove Cloud Provider"
													description="Are you sure you want to remove this provider? This will not delete any existing servers."
													onClick={() => handleRemove(provider.cloudProviderId)}
												>
													<button
														type="button"
														className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 outline-none"
													>
														<Trash2 className="size-4 mr-2" />
														Remove
													</button>
												</DialogAction>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							))}
						</div>
					)}
					<div className="flex justify-end gap-2 pt-2">
						<CreateBYOSServer />
						<HandleCloudProvider onSuccess={refetch} />
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

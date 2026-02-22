import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";
import { ProvisionServerLogs } from "./provision-server-logs";

const schema = z.object({
	name: z.string().min(1, "Name is required"),
	region: z.string().min(1, "Region is required"),
	serverSize: z.string().min(1, "Server size is required"),
	osImage: z.string().default("ubuntu-24.04"),
	sshKeyId: z.string().min(1, "SSH key is required"),
	masterServerId: z.string().min(1, "Master server is required"),
});

type FormValues = z.infer<typeof schema>;

interface Props {
	cloudProviderId: string;
}

export const CreateWorkerServer = ({ cloudProviderId }: Props) => {
	const [open, setOpen] = useState(false);
	const [jobId, setJobId] = useState<string | null>(null);
	const [selectedRegion, setSelectedRegion] = useState<string>("");

	const { data: sshKeys } = api.sshKey.all.useQuery();
	const { data: servers } = api.server.all.useQuery();
	const { data: regions, isLoading: regionsLoading } =
		api.cloudProvider.listRegions.useQuery(
			{ cloudProviderId },
			{ enabled: open },
		);
	const { data: sizes, isLoading: sizesLoading } =
		api.cloudProvider.listSizes.useQuery(
			{ cloudProviderId, region: selectedRegion },
			{ enabled: open && !!selectedRegion },
		);

	const { mutateAsync: createServer, isPending: isCreating } =
		api.server.createManaged.useMutation();
	const { mutateAsync: provision } = api.server.provision.useMutation();

	const masterServers = servers?.filter(
		(s) =>
			s.cloudProviderId &&
			s.k3sInstalled &&
			s.serverRole === "master",
	);

	const form = useForm<FormValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			name: "",
			region: "",
			serverSize: "",
			osImage: "ubuntu-24.04",
		},
	});

	const watchedRegion = form.watch("region");
	useEffect(() => {
		setSelectedRegion(watchedRegion);
		form.setValue("serverSize", "");
	}, [watchedRegion, form]);

	const onSubmit = async (values: FormValues) => {
		try {
			const newServer = await createServer({
				name: values.name,
				cloudProviderId,
				sshKeyId: values.sshKeyId,
				region: values.region,
				serverSize: values.serverSize,
				osImage: values.osImage,
				serverType: "deploy",
			});

			toast.success("Worker server created — starting provisioning...");

			const { jobId: jid } = await provision({
				serverId: newServer.serverId,
			});

			setJobId(jid);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error creating worker");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Plus className="size-4 mr-1" />
					Worker Node
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Server className="size-5" />
						Create Worker Node
					</DialogTitle>
					<DialogDescription>
						A VM will be provisioned and joined to the selected master server's
						K3s cluster.
					</DialogDescription>
				</DialogHeader>

				{jobId ? (
					<ProvisionServerLogs
						jobId={jobId}
						onDone={() => {
							setOpen(false);
							setJobId(null);
						}}
					/>
				) : (
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Server Name</FormLabel>
										<FormControl>
											<Input placeholder="worker-01" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="masterServerId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Master Server</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select master server" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{masterServers?.map((s) => (
													<SelectItem key={s.serverId} value={s.serverId}>
														{s.name} ({s.ipAddress})
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="sshKeyId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>SSH Key</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select SSH key" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{sshKeys?.map((key) => (
													<SelectItem key={key.sshKeyId} value={key.sshKeyId}>
														{key.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="region"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Region</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													{regionsLoading ? (
														<div className="flex items-center gap-2">
															<Loader2 className="size-4 animate-spin" />
															Loading regions...
														</div>
													) : (
														<SelectValue placeholder="Select region" />
													)}
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{regions?.map((r) => (
													<SelectItem key={r.id} value={r.id}>
														{r.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="serverSize"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Server Size</FormLabel>
										<Select
											onValueChange={field.onChange}
											value={field.value}
											disabled={!selectedRegion}
										>
											<FormControl>
												<SelectTrigger>
													{sizesLoading ? (
														<div className="flex items-center gap-2">
															<Loader2 className="size-4 animate-spin" />
															Loading sizes...
														</div>
													) : (
														<SelectValue
															placeholder={
																selectedRegion
																	? "Select server size"
																	: "Select a region first"
															}
														/>
													)}
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{sizes?.map((s) => (
													<SelectItem key={s.id} value={s.id}>
														<span>{s.name}</span>
														{s.price_monthly && (
															<span className="ml-2 text-muted-foreground text-xs">
																{s.price_monthly}
															</span>
														)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setOpen(false)}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={isCreating}>
									{isCreating ? (
										<>
											<Loader2 className="size-4 mr-2 animate-spin" />
											Creating...
										</>
									) : (
										"Create Worker"
									)}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
};

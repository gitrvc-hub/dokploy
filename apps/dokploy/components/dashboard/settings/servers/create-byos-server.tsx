import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Server } from "lucide-react";
import { useState } from "react";
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
	ipAddress: z.string().min(1, "IP address is required"),
	sshKeyId: z.string().min(1, "SSH key is required"),
	serverType: z.enum(["deploy", "build"] as const).default("deploy"),
});

type FormValues = z.infer<typeof schema>;

export const CreateBYOSServer = () => {
	const [open, setOpen] = useState(false);
	const [jobId, setJobId] = useState<string | null>(null);

	const { data: sshKeys } = api.sshKey.all.useQuery();

	const { mutateAsync: createServer, isPending: isCreating } =
		api.server.createBYOS.useMutation();
	const { mutateAsync: byosSetup } = api.server.byosSetup.useMutation();

	const form = useForm<FormValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			name: "",
			ipAddress: "",
			serverType: "deploy",
		},
	});

	const onSubmit = async (values: FormValues) => {
		try {
			const newServer = await createServer(values);

			toast.success("Server created — starting setup...");

			const { jobId: jid } = await byosSetup({
				serverId: newServer.serverId,
			});

			setJobId(jid);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error creating server");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Plus className="size-4 mr-1" />
					BYOS
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Server className="size-5" />
						Bring Your Own Server
					</DialogTitle>
					<DialogDescription>
						Connect an existing server by IP. K3s will be installed
						automatically.
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
											<Input placeholder="my-byos-server" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="ipAddress"
								render={({ field }) => (
									<FormItem>
										<FormLabel>IP Address</FormLabel>
										<FormControl>
											<Input placeholder="203.0.113.10" {...field} />
										</FormControl>
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
								name="serverType"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Server Type</FormLabel>
										<Select onValueChange={field.onChange} value={field.value}>
											<FormControl>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="deploy">Deploy</SelectItem>
												<SelectItem value="build">Build</SelectItem>
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
										"Create & Setup"
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

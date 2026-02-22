import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, Plus } from "lucide-react";
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

const createSchema = z.object({
	name: z.string().min(1, "Name is required"),
	providerType: z.enum(["hetzner", "digitalocean", "custom"] as const),
	apiToken: z.string().min(1, "API token is required"),
});

const editSchema = z.object({
	name: z.string().min(1, "Name is required"),
	apiToken: z.string().optional(),
});

interface Props {
	cloudProviderId?: string;
	onSuccess?: () => void;
}

export const HandleCloudProvider = ({ cloudProviderId, onSuccess }: Props) => {
	const [open, setOpen] = useState(false);
	const isEdit = !!cloudProviderId;

	const { data: provider } = api.cloudProvider.one.useQuery(
		{ cloudProviderId: cloudProviderId! },
		{ enabled: open && isEdit },
	);

	const { mutateAsync: create, isPending: isCreating } =
		api.cloudProvider.create.useMutation();
	const { mutateAsync: update, isPending: isUpdating } =
		api.cloudProvider.update.useMutation();

	const createForm = useForm<z.infer<typeof createSchema>>({
		resolver: zodResolver(createSchema),
		defaultValues: {
			name: "",
			providerType: "hetzner",
			apiToken: "",
		},
	});

	const editForm = useForm<z.infer<typeof editSchema>>({
		resolver: zodResolver(editSchema),
		defaultValues: {
			name: "",
			apiToken: "",
		},
	});

	useEffect(() => {
		if (provider && isEdit) {
			editForm.reset({
				name: provider.name,
				apiToken: "",
			});
		}
	}, [provider, isEdit, editForm]);

	const onCreateSubmit = async (values: z.infer<typeof createSchema>) => {
		try {
			await create(values);
			toast.success("Cloud provider added successfully");
			setOpen(false);
			createForm.reset();
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error creating provider");
		}
	};

	const onEditSubmit = async (values: z.infer<typeof editSchema>) => {
		try {
			await update({
				cloudProviderId: cloudProviderId!,
				name: values.name,
				apiToken: values.apiToken,
			});
			toast.success("Cloud provider updated successfully");
			setOpen(false);
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Error updating provider");
		}
	};

	const isPending = isCreating || isUpdating;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{isEdit ? (
					<button
						type="button"
						className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent outline-none"
					>
						<PencilIcon className="size-4 mr-2" />
						Edit
					</button>
				) : (
					<Button>
						<Plus className="size-4 mr-2" />
						Add Provider
					</Button>
				)}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{isEdit ? "Edit Cloud Provider" : "Add Cloud Provider"}
					</DialogTitle>
					<DialogDescription>
						{isEdit
							? "Update provider name or rotate the API token."
							: "Connect a cloud provider to provision servers automatically."}
					</DialogDescription>
				</DialogHeader>
				{isEdit ? (
					<Form {...editForm}>
						<form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
							<FormField
								control={editForm.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Name</FormLabel>
										<FormControl>
											<Input placeholder="My Hetzner Account" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={editForm.control}
								name="apiToken"
								render={({ field }) => (
									<FormItem>
										<FormLabel>API Token</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder="Leave empty to keep current token"
												{...field}
											/>
										</FormControl>
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
								<Button type="submit" disabled={isPending}>
									{isPending ? "Saving..." : "Update"}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				) : (
					<Form {...createForm}>
						<form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
							<FormField
								control={createForm.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Name</FormLabel>
										<FormControl>
											<Input placeholder="My Hetzner Account" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={createForm.control}
								name="providerType"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Provider</FormLabel>
										<Select
											onValueChange={field.onChange}
											defaultValue={field.value}
										>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select provider" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="hetzner">Hetzner</SelectItem>
												<SelectItem value="digitalocean">DigitalOcean</SelectItem>
												<SelectItem value="custom">Custom / BYOS</SelectItem>
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={createForm.control}
								name="apiToken"
								render={({ field }) => (
									<FormItem>
										<FormLabel>API Token</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder="Enter your API token"
												{...field}
											/>
										</FormControl>
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
								<Button type="submit" disabled={isPending}>
									{isPending ? "Saving..." : "Add Provider"}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
};

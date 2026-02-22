import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { TerminalLine } from "../../docker/logs/terminal-line";
import { type LogLine, parseLogs } from "../../docker/logs/utils";

interface Props {
	jobId: string;
	onDone: () => void;
}

export const ProvisionServerLogs = ({ jobId, onDone }: Props) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [autoScroll, setAutoScroll] = useState(true);
	const [filteredLogs, setFilteredLogs] = useState<LogLine[]>([]);
	const [isDone, setIsDone] = useState(false);
	const [hasError, setHasError] = useState(false);

	api.server.watchJobLogs.useSubscription(
		{ jobId },
		{
			enabled: !!jobId && !isDone,
			onData(log) {
				if (log === "[DONE]") {
					setIsDone(true);
					return;
				}
				const parsed = parseLogs(log);
				setFilteredLogs((prev) => [...prev, ...parsed]);
			},
			onError() {
				setHasError(true);
			},
		},
	);

	const handleScroll = () => {
		if (!scrollRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
		setAutoScroll(Math.abs(scrollHeight - scrollTop - clientHeight) < 10);
	};

	useEffect(() => {
		if (autoScroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [filteredLogs, autoScroll]);

	return (
		<div className="flex flex-col gap-3">
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="h-72 overflow-y-auto border rounded-md p-3 bg-[#fafafa] dark:bg-[#050506] space-y-0 custom-logs-scrollbar"
			>
				{filteredLogs.length > 0 ? (
					filteredLogs.map((log, i) => (
						<TerminalLine key={i} log={log} noTimestamp />
					))
				) : (
					<div className="flex justify-center items-center h-full text-muted-foreground gap-2">
						<Loader2 className="size-4 animate-spin" />
						<span className="text-sm">Waiting for provisioner...</span>
					</div>
				)}
			</div>

			{isDone && (
				<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
					<CheckCircle2 className="size-4" />
					Provisioning complete
				</div>
			)}

			{hasError && (
				<p className="text-sm text-destructive">
					Lost connection to provisioner. Check logs for details.
				</p>
			)}

			<Button
				variant={isDone ? "default" : "outline"}
				onClick={onDone}
				disabled={!isDone && !hasError}
			>
				{isDone ? "Close" : "Running..."}
			</Button>
		</div>
	);
};

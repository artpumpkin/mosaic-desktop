import { AlertTriangle, RotateCw } from "lucide-react";
import GlassCard from "@/components/GlassCard";

export default function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <GlassCard className="border-rose-500/20">
      <div className="py-10 text-center flex flex-col items-center gap-3">
        <span className="grid place-items-center w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
          <AlertTriangle size={28} strokeWidth={1.75} />
        </span>
        <p className="text-sm text-neutral-300 max-w-md">{message}</p>
        {onRetry && (
          <button type="button" className="btn-ghost mt-1" onClick={onRetry}>
            <RotateCw size={14} strokeWidth={2} />
            Retry
          </button>
        )}
      </div>
    </GlassCard>
  );
}

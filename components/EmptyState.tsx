import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import GlassCard from "@/components/GlassCard";

export default function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <GlassCard>
      <div className="py-10 text-center flex flex-col items-center gap-3">
        <span className="grid place-items-center w-12 h-12 rounded-xl bg-white/[0.02] border border-white/5 text-neutral-600">
          <Icon size={28} strokeWidth={1.75} />
        </span>
        <div className="space-y-1">
          <p className="text-sm text-neutral-400">{title}</p>
          {hint && <p className="text-[11px] text-neutral-500">{hint}</p>}
        </div>
        {action && <div className="mt-1">{action}</div>}
      </div>
    </GlassCard>
  );
}

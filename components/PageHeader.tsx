import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  right,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 border border-white/10 text-violet-200">
          <Icon size={20} strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-neutral-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

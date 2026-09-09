import clsx from "clsx";
import { HTMLAttributes } from "react";

export default function GlassCard({
  className,
  children,
  hover = false,
  padding = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean; padding?: boolean }) {
  return (
    <div
      className={clsx(
        "glass rounded-2xl",
        padding && "p-5 md:p-6",
        hover && "glass-hover",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

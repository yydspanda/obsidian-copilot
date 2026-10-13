import * as React from "react";
import { cn } from "@/lib/utils";

export const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("tw-font-semibold tw-leading-none tw-tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

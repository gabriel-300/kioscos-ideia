import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "outline";

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:  "bg-neutral-100 text-neutral-700",
  success:  "bg-success-bg text-success",
  warning:  "bg-warning-bg text-warning",
  danger:   "bg-danger-bg text-danger",
  info:     "bg-info-bg text-info",
  outline:  "border border-neutral-300 text-neutral-600 bg-transparent",
};

export function Badge({ variant = "default", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide uppercase",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: BadgeVariant }> = {
    pending_payment: { label: "Pendiente",               variant: "warning" },
    payment_review:  { label: "Revisando pago",          variant: "info" },
    paid:            { label: "Pago confirmado",          variant: "success" },
    preparing:       { label: "En preparación",           variant: "info" },
    ready:           { label: "Listo para despachar",     variant: "success" },
    in_delivery:     { label: "En camino",                variant: "info" },
    shipped:         { label: "Despachado",               variant: "info" },
    delivered:       { label: "Entregado",                variant: "success" },
    cancelled:       { label: "Cancelado",                variant: "danger" },
    refunded:        { label: "Reembolsado",              variant: "outline" },
    aprobado:        { label: "Aprobado",                 variant: "success" },
    enviado_prod:    { label: "Enviado a producción",     variant: "info" },
    despachado:      { label: "Despachado",               variant: "success" },
    en_distribucion:  { label: "En distribución",          variant: "info" },
    entrega_parcial:  { label: "Entrega parcial",          variant: "warning" },
  };

  const { label, variant } = config[status] ?? { label: status, variant: "default" as BadgeVariant };

  return <Badge variant={variant}>{label}</Badge>;
}

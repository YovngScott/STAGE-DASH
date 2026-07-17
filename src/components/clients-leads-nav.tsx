import { Link, useRouterState } from "@tanstack/react-router";
import { UsersRound, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

// Sub-navegación compartida entre Client Manager y Leads: los leads viven
// "dentro" de la gestión de clientes, así que desde cualquiera de las dos
// páginas se salta a la otra con esta misma pestaña (y se regresa igual).
const tabs = [
  { title: "Clients", url: "/clients", icon: UsersRound },
  { title: "Leads", url: "/leads", icon: UserPlus },
];

export function ClientsLeadsNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.url);
        return (
          <Link
            key={t.url}
            to={t.url}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.title}
          </Link>
        );
      })}
    </div>
  );
}

import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Bot,
  BrainCircuit,
  Users,
  UserPlus,
  Globe,
  Wallet,
  Settings,
  LogOut,
  Palette,
  Activity,
  LayoutGrid,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

// Orden lógico del menú: primero el panorama (Dashboard), luego todo lo
// relacionado a bots y la aplicación web agrupado bajo "Servicios" (colapsable),
// y por último la operación comercial (Leads, clientes, finanzas).
const mainItems = [{ title: "Dashboard", url: "/", icon: LayoutDashboard }];

// Todo lo relacionado a bots y a la aplicación web vive aquí adentro.
const servicios = [
  { title: "Bot Builder", url: "/bot-builder", icon: BrainCircuit },
  { title: "Salud de bots", url: "/health", icon: Activity },
  { title: "My Products", url: "/products", icon: Bot },
  { title: "Web Apps", url: "/webapps", icon: Globe },
];

const businessItems = [
  { title: "Leads", url: "/leads", icon: UserPlus },
  { title: "Client Manager", url: "/clients", icon: Users },
  { title: "Financial Ledger", url: "/ledger", icon: Wallet },
];

export function AppSidebar({
  onSignOut,
  email,
}: {
  onSignOut: () => void | Promise<void>;
  email: string;
}) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (path: string) => (path === "/" ? pathname === "/" : pathname.startsWith(path));
  const serviciosActive = servicios.some((s) => isActive(s.url));

  const initials =
    email
      .split("@")[0]
      .split(/[._-]/)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "OW";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white p-1.5 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-1"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            <img src="/logo.png" alt="Stage AI Labs" className="h-full w-full object-contain" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">Stage AI Labs</span>
            <span className="text-[11px] text-muted-foreground">Owner Console</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Servicios: un solo botón que despliega todo lo de bots y la web app. */}
              <Collapsible defaultOpen={serviciosActive} className="group/servicios" asChild>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton isActive={serviciosActive} tooltip="Servicios">
                      <LayoutGrid className="h-4 w-4" />
                      <span>Servicios</span>
                      <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/servicios:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {servicios.map((item) => (
                        <SidebarMenuSubItem key={item.title}>
                          <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                            <Link to={item.url}>
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {businessItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
              <Link to="/settings">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/website")} tooltip="Customize Website">
              <Link to="/website">
                <Palette className="h-4 w-4" />
                <span>Customize Website</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:hidden">
          <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <div className="flex flex-col leading-tight min-w-0 flex-1">
            <span className="text-xs font-medium">Owner</span>
            <span className="text-[10px] text-muted-foreground truncate">{email}</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => void onSignOut()}
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="hidden group-data-[collapsible=icon]:flex justify-center py-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => void onSignOut()}
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

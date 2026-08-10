import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  Navigate,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { LanguageProvider, useLanguage } from "@/hooks/use-language";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  const { text } = useLanguage();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <h2 className="mt-4 text-xl font-semibold">
          {text("Página no encontrada", "Page not found")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {text("La página que buscas no existe.", "The page you're looking for doesn't exist.")}
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {text("Ir al panel", "Go to Dashboard")}
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const { text } = useLanguage();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">
          {text("Esta página no cargó", "This page didn't load")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {text("Algo salió mal.", "Something went wrong.")}
        </p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {text("Intentar de nuevo", "Try again")}
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Stage AI Labs — Owner Console" },
      {
        name: "description",
        content:
          "Internal SaaS console for Stage AI Labs LLC — manage MRR, clients, investments, and AI product operations.",
      },
      { property: "og:title", content: "Stage AI Labs — Owner Console" },
      { property: "og:description", content: "Internal SaaS console for Stage AI Labs LLC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
        <Scripts />
      </body>
    </html>
  );
}

function AppShell() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { loading, session, isOwner, signOut } = useAuth();
  const { text } = useLanguage();
  const titleMap: Record<string, string> = {
    "/": text("Panel", "Dashboard"),
    "/products": text("Mis productos", "My Products"),
    "/bot-builder": text("Creador de bots", "Bot Builder"),
    "/quality-center": text("Centro de Calidad", "Quality Center"),
    "/health": text("Salud de bots", "Bot Health"),
    "/clients": text("Gestión de clientes", "Client Manager"),
    "/leads": text("Prospectos", "Leads"),
    "/webapps": text("Aplicaciones web", "Web Apps"),
    "/ledger": text("Libro financiero", "Financial Ledger"),
    "/settings": text("Configuración", "Settings"),
    "/website": text("Personalizar sitio web", "Customize Website"),
  };

  const isAuthRoute = pathname === "/auth";

  // While hydrating auth on a protected route, render nothing to avoid a flash.
  if (loading && !isAuthRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-xs text-muted-foreground">
        {text("Verificando acceso…", "Verifying access…")}
      </div>
    );
  }

  // Public auth page renders standalone (no sidebar/header).
  if (isAuthRoute) {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  }

  // Not signed in OR signed in without owner role → force /auth.
  if (!session || !isOwner) {
    return <Navigate to="/auth" />;
  }

  const title =
    titleMap[pathname] ??
    Object.entries(titleMap).find(([k]) => k !== "/" && pathname.startsWith(k))?.[1] ??
    "Console";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar onSignOut={signOut} email={session.user.email ?? ""} />
        <div className="flex flex-1 flex-col min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl">
            <SidebarTrigger />
            <div className="h-4 w-px bg-border" />
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {text("Consola", "Console")}
              </span>
              <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                {text("Todos los sistemas operativos", "All systems operational")}
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
    </SidebarProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  );
}

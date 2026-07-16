import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Power,
  Search,
  Trash2,
  Loader2,
  CheckCircle2,
  Zap,
  ZapOff,
  Bot,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  Mail,
  KeyRound,
  Link2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/clients")({
  component: Clients,
});

// Toggling this service on/off in the edit dialog automatically turns the
// client's linked bot (bot_status_url/bot_secret) on/off — the messaging
// service IS the bot from the client's point of view.
const BOT_TOGGLE_SERVICE = "AI Messaging Suite";

interface Client {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  mrr: number;
  billing_cycle: string;
  next_billing_date: string | null;
  services: string[] | null;
  notes: string | null;
  created_at: string;
  bot_status_url: string | null;
  bot_secret: string | null;
  bot_activo: boolean;
}

interface Product {
  id: string;
  name: string;
  monthly_cost: number;
}

interface ClientBot {
  id: string;
  client_id: string;
  name: string;
  slug: string;
  kind: string;
  product_name: string | null;
  status: string;
  bot_status_url: string | null;
  bot_secret: string | null;
  dashboard_url: string | null;
  github_commit_url: string | null;
  created_at: string;
  prompt_extra?: string | null;
}

interface ClientDashboard {
  id: string;
  client_id: string;
  bot_id: string | null;
  name: string;
  slug: string;
  url: string | null;
  provider: string;
  status: string;
  created_at: string;
}

interface ClientEmailAccount {
  id: string;
  client_id: string;
  email: string;
  display_name: string | null;
  provider: string;
  status: string;
  auth_user_id: string | null;
  created_at: string;
}

interface WebApp {
  id: string;
  name: string;
  url: string | null;
  hosting_provider: string | null;
  status: string;
  client_id?: string | null;
}

const emptyDraft = {
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  status: "active",
  mrr: 0,
  billing_cycle: "monthly",
  next_billing_day: 5,
  services: [] as string[],
  notes: "",
  bot_status_url: "",
  bot_secret: "",
};

const emptyUserDraft = {
  tenantSlug: "",
  email: "",
  password: "",
  displayName: "",
};

const emptyIntegrationDraft = {
  botStatusUrl: "",
  botSecret: "",
};

const emptyBotEditDraft = { name: "", promptExtra: "" };

function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [bots, setBots] = useState<ClientBot[]>([]);
  const [dashboards, setDashboards] = useState<ClientDashboard[]>([]);
  const [clientWebApps, setClientWebApps] = useState<WebApp[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<ClientEmailAccount[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userDraft, setUserDraft] = useState({ ...emptyUserDraft });
  const [creatingUser, setCreatingUser] = useState(false);
  const [integrationDialogOpen, setIntegrationDialogOpen] = useState(false);
  const [integrationBot, setIntegrationBot] = useState<ClientBot | null>(null);
  const [integrationDraft, setIntegrationDraft] = useState({ ...emptyIntegrationDraft });
  const [botEditDialogOpen, setBotEditDialogOpen] = useState(false);
  const [botEditBot, setBotEditBot] = useState<ClientBot | null>(null);
  const [botEditDraft, setBotEditDraft] = useState({ ...emptyBotEditDraft });
  const [savingBotEdit, setSavingBotEdit] = useState(false);

  const load = async () => {
    setLoading(true);
    const [cRes, pRes] = await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: true }),
      supabase.from("products").select("id,name,monthly_cost").order("name"),
    ]);
    if (cRes.error) toast.error(cRes.error.message);
    else setClients((cRes.data ?? []) as Client[]);
    if (pRes.error) toast.error(pRes.error.message);
    else setProducts((pRes.data ?? []) as Product[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const loadClientResources = async (client: Client) => {
    setResourcesLoading(true);
    const [botsRes, dashboardsRes, webAppsRes, emailsRes] = await Promise.all([
      supabase
        .from("client_bots")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("client_dashboards")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("web_apps")
        .select("id,name,url,hosting_provider,status,client_id")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("client_email_accounts")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
    ]);

    const fallbackBots = buildFallbackBots(client);
    const loadedBots = botsRes.error ? [] : ((botsRes.data ?? []) as ClientBot[]);

    setBots(loadedBots.length > 0 ? loadedBots : fallbackBots);
    setDashboards(dashboardsRes.error ? [] : ((dashboardsRes.data ?? []) as ClientDashboard[]));
    setClientWebApps(webAppsRes.error ? [] : ((webAppsRes.data ?? []) as WebApp[]));
    setEmailAccounts(emailsRes.error ? [] : ((emailsRes.data ?? []) as ClientEmailAccount[]));
    setResourcesLoading(false);
  };

  const openClientProfile = (client: Client) => {
    setSelectedClient(client);
    setUserDraft({
      tenantSlug: extractSlugFromBotUrl(client.bot_status_url ?? "") || "",
      email: client.email ?? "",
      password: "",
      displayName: client.contact_name ?? "",
    });
    void loadClientResources(client);
  };

  const filtered = useMemo(
    () =>
      clients.filter((c) =>
        c.company_name.toLowerCase().includes(query.toLowerCase()),
      ),
    [clients, query],
  );

  const totalMrr = clients.reduce(
    (s, c) => s + (c.status === "active" ? Number(c.mrr) : 0),
    0,
  );

  const sumServices = (services: string[]) =>
    services.reduce(
      (s, name) => s + (products.find((p) => p.name === name)?.monthly_cost ?? 0),
      0,
    );

  const openNew = () => {
    setEditing(null);
    setDraft({ ...emptyDraft });
    setOpen(true);
  };
  const openEdit = (c: Client) => {
    setEditing(c);
    const day = c.next_billing_date
      ? new Date(c.next_billing_date).getUTCDate()
      : 5;
    setDraft({
      company_name: c.company_name,
      contact_name: c.contact_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      status: c.status,
      mrr: Number(c.mrr),
      billing_cycle: c.billing_cycle,
      next_billing_day: day,
      services: Array.isArray(c.services) ? c.services : [],
      notes: c.notes ?? "",
      bot_status_url: c.bot_status_url ?? "",
      bot_secret: c.bot_secret ?? "",
    });
    setOpen(true);
  };

  const toggleService = (name: string) => {
    setDraft((d) => {
      const services = d.services.includes(name)
        ? d.services.filter((s) => s !== name)
        : [...d.services, name];
      return { ...d, services, mrr: sumServices(services) };
    });
  };

  const nextBillingDate = (day: number) => {
    const now = new Date();
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(28, Math.max(1, day))),
    );
    if (d.getTime() < now.getTime())
      d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.company_name.trim()) return;
    setSaving(true);

    const botStatusUrl = draft.bot_status_url.trim() || null;
    const botSecret = draft.bot_secret.trim() || null;
    const hadMessaging = (editing?.services ?? []).includes(BOT_TOGGLE_SERVICE);
    const hasMessagingNow = draft.services.includes(BOT_TOGGLE_SERVICE);
    const messagingChanged = editing && hadMessaging !== hasMessagingNow;
    let botActivo = editing?.bot_activo ?? true;

    if (messagingChanged && botStatusUrl && botSecret) {
      try {
        await callBotToggle(editing.id, hasMessagingNow);
        botActivo = hasMessagingNow;
        toast.success(`Bot turned ${hasMessagingNow ? "on" : "off"} (AI Messaging Suite ${hasMessagingNow ? "added" : "removed"})`);
      } catch (err) {
        toast.error(
          `Couldn't reach the bot to turn it ${hasMessagingNow ? "on" : "off"}: ${err instanceof Error ? err.message : "unknown error"}. Saving the rest of the changes anyway.`,
        );
      }
    }

    const payload = {
      company_name: draft.company_name.trim(),
      contact_name: draft.contact_name.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      status: draft.status,
      mrr: Number(draft.mrr) || 0,
      billing_cycle: draft.billing_cycle,
      next_billing_date: nextBillingDate(draft.next_billing_day),
      services: draft.services,
      notes: draft.notes.trim() || null,
      bot_status_url: botStatusUrl,
      bot_secret: botSecret,
      bot_activo: botActivo,
    };
    const q = editing
      ? supabase.from("clients").update(payload).eq("id", editing.id)
      : supabase.from("clients").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Client updated" : "Client added");
    setOpen(false);
    void load();
  };

  const toggleActive = async (c: Client) => {
    const next = c.status === "active" ? "paused" : "active";
    const { error } = await supabase
      .from("clients")
      .update({ status: next })
      .eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(
      `${c.company_name} ${next === "active" ? "reactivated" : "paused"}`,
    );
    void load();
  };

  const callBotToggle = async (
    clientId: string,
    activo: boolean,
    target?: {
      botId?: string;
      botSlug?: string;
      botStatusUrl?: string | null;
      botSecret?: string | null;
    },
  ) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Your session expired — sign in again.");
    const res = await fetch("/api/bot-toggle", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        clientId,
        botId: target?.botId,
        botSlug: target?.botSlug,
        activo,
        botStatusUrl: target?.botStatusUrl,
        botSecret: target?.botSecret,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? "Failed to reach the bot.");
  };

  const [togglingBot, setTogglingBot] = useState<string | null>(null);
  const toggleBot = async (c: Client) => {
    const next = !c.bot_activo;
    setTogglingBot(c.id);
    try {
      await callBotToggle(c.id, next, {
        botStatusUrl: c.bot_status_url,
        botSecret: c.bot_secret,
      });
      toast.success(`${c.company_name}'s bot turned ${next ? "on" : "off"}`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle the bot.");
    } finally {
      setTogglingBot(null);
    }
  };

  const toggleClientBot = async (bot: ClientBot) => {
    if (!selectedClient) return;
    if (!bot.bot_secret) {
      toast.error("Este bot necesita Bot secret para apagar/encender en local. Edita el cliente y pega PLATFORM_ADMIN_SECRET.");
      return;
    }
    const next = bot.status !== "active";
    setTogglingBot(bot.id);
    try {
      await callBotToggle(selectedClient.id, next, {
        botId: bot.id === "primary" ? undefined : bot.id,
        botSlug: bot.slug,
        botStatusUrl: bot.bot_status_url,
        botSecret: bot.bot_secret,
      });
      setBots((items) =>
        items.map((item) =>
          item.id === bot.id ? { ...item, status: next ? "active" : "paused" } : item,
        ),
      );
      setSelectedClient((client) =>
        client && client.id === selectedClient.id
          ? { ...client, bot_activo: next }
          : client,
      );
      setClients((items) =>
        items.map((client) =>
          client.id === selectedClient.id ? { ...client, bot_activo: next } : client,
        ),
      );
      toast.success(`${bot.name} turned ${next ? "on" : "off"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle the bot.");
    } finally {
      setTogglingBot(null);
    }
  };

  const openBotIntegration = (bot: ClientBot) => {
    setIntegrationBot(bot);
    setIntegrationDraft({
      botStatusUrl: bot.bot_status_url ?? "",
      botSecret: bot.bot_secret ?? "",
    });
    setIntegrationDialogOpen(true);
  };

  const openBotEdit = (bot: ClientBot) => {
    setBotEditBot(bot);
    setBotEditDraft({ name: bot.name, promptExtra: bot.prompt_extra ?? "" });
    setBotEditDialogOpen(true);
  };

  const saveBotEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!botEditBot) return;
    setSavingBotEdit(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired — sign in again.");
      const res = await fetch("/api/bot-edit", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ botId: botEditBot.id, name: botEditDraft.name, promptExtra: botEditDraft.promptExtra }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "No se pudo actualizar el bot.");
      setBots((items) => items.map((item) => item.id === botEditBot.id ? { ...item, name: botEditDraft.name, prompt_extra: botEditDraft.promptExtra } : item));
      toast.success("Bot actualizado y guardado en GitHub.");
      setBotEditDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar el bot.");
    } finally {
      setSavingBotEdit(false);
    }
  };

  const saveBotIntegration = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedClient || !integrationBot) return;

    const botStatusUrl = integrationDraft.botStatusUrl.trim() || null;
    const botSecret = integrationDraft.botSecret.trim() || null;

    const updates = {
      bot_status_url: botStatusUrl,
      bot_secret: botSecret,
    };

    const clientUpdate = await supabase
      .from("clients")
      .update(updates)
      .eq("id", selectedClient.id);
    if (clientUpdate.error) return toast.error(clientUpdate.error.message);

    if (integrationBot.id !== "primary") {
      const botUpdate = await supabase
        .from("client_bots")
        .update(updates)
        .eq("id", integrationBot.id);
      if (botUpdate.error) return toast.error(botUpdate.error.message);
    }

    setBots((items) =>
      items.map((item) =>
        item.id === integrationBot.id
          ? { ...item, bot_status_url: botStatusUrl, bot_secret: botSecret }
          : item,
      ),
    );
    setSelectedClient((client) =>
      client && client.id === selectedClient.id
        ? { ...client, bot_status_url: botStatusUrl, bot_secret: botSecret }
        : client,
    );
    setClients((items) =>
      items.map((client) =>
        client.id === selectedClient.id
          ? { ...client, bot_status_url: botStatusUrl, bot_secret: botSecret }
          : client,
      ),
    );
    setIntegrationDialogOpen(false);
    setIntegrationBot(null);
    setIntegrationDraft({ ...emptyIntegrationDraft });
    toast.success("Bot integration saved");
  };

  const createDashboardUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;
    setCreatingUser(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired — sign in again.");
      const res = await fetch("/api/client-admin-user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: selectedClient.id,
          tenantSlug: userDraft.tenantSlug,
          email: userDraft.email,
          password: userDraft.password,
          displayName: userDraft.displayName,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Could not create the user.");
      toast.success(`${userDraft.email} created for ${selectedClient.company_name}`);
      setUserDialogOpen(false);
      setUserDraft({ ...emptyUserDraft });
      void loadClientResources(selectedClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the user.");
    } finally {
      setCreatingUser(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", confirmDelete.id);
    if (error) return toast.error(error.message);
    toast.success(`${confirmDelete.company_name} deleted`);
    setConfirmDelete(null);
    void load();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            B2B Accounts
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Client Manager
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {clients.length} clients · ${totalMrr.toLocaleString()} MRR contracted
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search clients…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 w-56"
            />
          </div>
          <Button className="gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" /> Add New Client
          </Button>
        </div>
      </div>

      <Card className="border-border/60 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading clients…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead>Next billing</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className="border-border/60 cursor-pointer"
                  onClick={() => openClientProfile(c)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                        {c.company_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium">{c.company_name}</span>
                        {c.contact_name && (
                          <span className="text-[11px] text-muted-foreground">
                            {c.contact_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {(c.services ?? []).map((s) => (
                        <Badge
                          key={s}
                          variant="secondary"
                          className="font-normal"
                        >
                          {s}
                        </Badge>
                      ))}
                      {(!c.services || c.services.length === 0) && (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        c.status === "active"
                          ? "bg-success/15 text-success border-success/30"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    ${Number(c.mrr).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.next_billing_date
                      ? new Date(c.next_billing_date).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(c);
                        }}
                        title="Edit client"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleActive(c);
                        }}
                        title={
                          c.status === "active"
                            ? "Pause client"
                            : "Reactivate client"
                        }
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                      {(c.bot_status_url || (c.services ?? []).includes(BOT_TOGGLE_SERVICE)) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            openClientProfile(c);
                          }}
                          title="Open bot controls"
                          className={c.bot_activo ? "text-success hover:text-success" : "text-destructive hover:text-destructive"}
                        >
                          {c.bot_activo ? (
                            <Zap className="h-4 w-4" />
                          ) : (
                            <ZapOff className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmDelete(c);
                        }}
                        title="Delete client"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {clients.length === 0
                      ? "No clients yet. Click “Add New Client” to onboard your first account."
                      : "No clients match your search."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Sheet
        open={!!selectedClient}
        onOpenChange={(openSheet) => !openSheet && setSelectedClient(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          {selectedClient && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedClient.company_name}</SheetTitle>
                <SheetDescription>
                  {selectedClient.contact_name || "Client workspace"} · {selectedClient.email || "No email"}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <ResourceStat label="Bots" value={bots.length} />
                <ResourceStat label="Dashboards" value={dashboards.length} />
                <ResourceStat label="Web apps" value={clientWebApps.length} />
              </div>

              <Tabs defaultValue="bots" className="mt-5">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="bots">Bots</TabsTrigger>
                  <TabsTrigger value="dashboards">Dashboards</TabsTrigger>
                  <TabsTrigger value="webapps">Web Apps</TabsTrigger>
                  <TabsTrigger value="access">Access</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-3 pt-3">
                  <InfoCard
                    icon={Power}
                    title="Client status"
                    description={`${selectedClient.status} · $${Number(selectedClient.mrr).toLocaleString()} MRR`}
                  />
                  <InfoCard
                    icon={Mail}
                    title="Primary contact"
                    description={selectedClient.email || "No email saved"}
                  />
                  <InfoCard
                    icon={Bot}
                    title="Primary bot endpoint"
                    description={selectedClient.bot_status_url || "No bot endpoint saved yet"}
                  />
                </TabsContent>

                <TabsContent value="bots" className="space-y-3 pt-3">
                  {resourcesLoading ? (
                    <LoadingLine label="Loading bots..." />
                  ) : bots.length === 0 ? (
                    <EmptyResource label="No bots registered for this client yet." />
                  ) : (
                    bots.map((bot) => (
                      <ResourceCard key={bot.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-primary" />
                              <h4 className="font-medium">{bot.name}</h4>
                              <Badge variant="outline">{bot.kind}</Badge>
                            </div>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {bot.bot_status_url || "No endpoint"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openBotEdit(bot)}
                              title="Editar detalles y prompt extra"
                              className="text-muted-foreground hover:text-primary"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openBotIntegration(bot)}
                              title="Editar conexión del bot"
                              className={bot.bot_status_url && bot.bot_secret ? "text-primary hover:text-primary" : "text-warning hover:text-warning"}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={!bot.bot_status_url || togglingBot === bot.id}
                              onClick={() => void toggleClientBot(bot)}
                              title={bot.status === "active" ? "Turn bot off" : "Turn bot on"}
                              className={bot.status === "active" ? "text-success hover:text-success" : "text-destructive hover:text-destructive"}
                            >
                              {togglingBot === bot.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : bot.status === "active" ? (
                                <Zap className="h-4 w-4" />
                              ) : (
                                <ZapOff className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </ResourceCard>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="dashboards" className="space-y-3 pt-3">
                  {resourcesLoading ? (
                    <LoadingLine label="Loading dashboards..." />
                  ) : dashboards.length === 0 ? (
                    <EmptyResource label="No dashboards registered yet." />
                  ) : (
                    dashboards.map((dashboard) => (
                      <ResourceCard key={dashboard.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <LayoutDashboard className="h-4 w-4 text-primary" />
                              <h4 className="font-medium">{dashboard.name}</h4>
                              <Badge variant="outline">{dashboard.status}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {dashboard.provider} · {dashboard.slug}
                            </p>
                          </div>
                          {dashboard.url && (
                            <Button size="icon" variant="ghost" asChild title="Open dashboard">
                              <a href={dashboard.url} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </ResourceCard>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="webapps" className="space-y-3 pt-3">
                  {resourcesLoading ? (
                    <LoadingLine label="Loading web apps..." />
                  ) : clientWebApps.length === 0 ? (
                    <EmptyResource label="No web apps linked to this client yet." />
                  ) : (
                    clientWebApps.map((app) => (
                      <ResourceCard key={app.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Globe2 className="h-4 w-4 text-primary" />
                              <h4 className="font-medium">{app.name}</h4>
                              <Badge variant="outline">{app.status}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {app.hosting_provider || "Local"}
                            </p>
                          </div>
                          {app.url && (
                            <Button size="icon" variant="ghost" asChild title="Open web app">
                              <a href={app.url} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </ResourceCard>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="access" className="space-y-3 pt-3">
                  <div className="flex justify-end">
                    <Button
                      className="gap-2"
                      onClick={() => {
                        setUserDraft({
                          tenantSlug: bots[0]?.slug || extractSlugFromBotUrl(selectedClient.bot_status_url ?? "") || "",
                          email: selectedClient.email ?? "",
                          password: "",
                          displayName: selectedClient.contact_name ?? "",
                        });
                        setUserDialogOpen(true);
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                      Create dashboard user
                    </Button>
                  </div>
                  {emailAccounts.length === 0 ? (
                    <EmptyResource label="No dashboard users tracked yet." />
                  ) : (
                    emailAccounts.map((account) => (
                      <ResourceCard key={account.id}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4 text-primary" />
                              <h4 className="font-medium">{account.email}</h4>
                              <Badge variant="outline">{account.status}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {account.display_name || "No display name"} · {account.provider}
                            </p>
                          </div>
                        </div>
                      </ResourceCard>
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={integrationDialogOpen} onOpenChange={setIntegrationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bot connection</DialogTitle>
            <DialogDescription>
              Guarda los datos técnicos para que el rayo pueda encender/apagar este bot desde el dashboard local.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveBotIntegration} className="space-y-4">
            <div className="space-y-2">
              <Label>Bot status URL</Label>
              <Input
                placeholder="https://wiltech-bot.fly.dev/api/<slug>/config/bot-activo"
                value={integrationDraft.botStatusUrl}
                onChange={(e) =>
                  setIntegrationDraft((draft) => ({ ...draft, botStatusUrl: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Bot secret</Label>
              <Input
                placeholder="PLATFORM_ADMIN_SECRET"
                type="password"
                value={integrationDraft.botSecret}
                onChange={(e) =>
                  setIntegrationDraft((draft) => ({ ...draft, botSecret: e.target.value }))
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit">Save connection</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={botEditDialogOpen} onOpenChange={setBotEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar bot</DialogTitle>
            <DialogDescription>Actualiza el nombre y el prompt extra. El tenant se sincroniza en GitHub.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveBotEdit} className="space-y-4">
            <div className="space-y-2"><Label>Nombre del bot</Label><Input value={botEditDraft.name} onChange={(e) => setBotEditDraft((d) => ({ ...d, name: e.target.value }))} required /></div>
            <div className="space-y-2"><Label>Prompt extra</Label><Textarea value={botEditDraft.promptExtra} onChange={(e) => setBotEditDraft((d) => ({ ...d, promptExtra: e.target.value }))} placeholder="Instrucciones adicionales para este cliente..." rows={6} /></div>
            <DialogFooter><Button type="submit" disabled={savingBotEdit}>{savingBotEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar cambios"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create dashboard user</DialogTitle>
            <DialogDescription>
              Creates the user in the bot Supabase project and grants access to the selected tenant.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createDashboardUser} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tenant slug</Label>
                <Input
                  value={userDraft.tenantSlug}
                  onChange={(e) => setUserDraft((d) => ({ ...d, tenantSlug: e.target.value }))}
                  placeholder="w-corp"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input
                  value={userDraft.displayName}
                  onChange={(e) => setUserDraft((d) => ({ ...d, displayName: e.target.value }))}
                  placeholder="William Vargas"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={userDraft.email}
                onChange={(e) => setUserDraft((d) => ({ ...d, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Temporary password</Label>
              <Input
                type="password"
                value={userDraft.password}
                onChange={(e) => setUserDraft((d) => ({ ...d, password: e.target.value }))}
                minLength={8}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={creatingUser}>
                {creatingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.company_name}` : "Add new client"}
            </DialogTitle>
            <DialogDescription>
              Onboard a B2B account and start billing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="c-name">Client name</Label>
                <Input
                  id="c-name"
                  value={draft.company_name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, company_name: e.target.value }))
                  }
                  required
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-contact">Contact name</Label>
                <Input
                  id="c-contact"
                  value={draft.contact_name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, contact_name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-email">Email</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={draft.email}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, email: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Services</Label>
              {products.length === 0 && draft.services.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  No products yet — create products first in My Products.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[
                    ...products.map((p) => p.name),
                    // Services picked on the public site (e.g. via a lead conversion) may not
                    // exist in the product catalog — still show them so they can be removed.
                    ...draft.services.filter((s) => !products.some((p) => p.name === s)),
                  ].map((name) => {
                    const active = draft.services.includes(name);
                    return (
                      <button
                        type="button"
                        key={name}
                        onClick={() => toggleService(name)}
                        className={
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all " +
                          (active
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground")
                        }
                      >
                        {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="c-mrr">Monthly (USD)</Label>
                <Input
                  id="c-mrr"
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.mrr}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, mrr: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-day">Billing day</Label>
                <Input
                  id="c-day"
                  type="number"
                  min={1}
                  max={28}
                  value={draft.next_billing_day}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      next_billing_day: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Save client"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.company_name} and their billing history will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResourceStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ResourceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      {children}
    </div>
  );
}

function EmptyResource({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border/60 p-6 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <ResourceCard>
        <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <h4 className="font-medium">{title}</h4>
          <p className="mt-1 break-all text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </ResourceCard>
  );
}

function extractSlugFromBotUrl(url: string) {
  const match = url.match(/\/api\/([^/]+)\/config\/bot-activo/);
  return match?.[1] ?? "";
}

function buildFallbackBots(client: Client): ClientBot[] {
  const hasMessaging = (client.services ?? []).includes(BOT_TOGGLE_SERVICE);
  if (!client.bot_status_url && !hasMessaging) return [];

  const slug = extractSlugFromBotUrl(client.bot_status_url ?? "") || knownTenantSlug(client);
  const endpoint = client.bot_status_url || (slug ? `https://wiltech-bot.fly.dev/api/${slug}/config/bot-activo` : null);

  return [
    {
      id: "primary",
      client_id: client.id,
      name: `${client.company_name} Bot`,
      slug: slug || "bot",
      kind: "messaging",
      product_name: BOT_TOGGLE_SERVICE,
      status: client.bot_activo ? "active" : "draft",
      bot_status_url: endpoint,
      bot_secret: client.bot_secret,
      dashboard_url: null,
      github_commit_url: null,
      created_at: client.created_at,
    },
  ];
}

function knownTenantSlug(client: Client) {
  const name = client.company_name.toLowerCase();
  if (name.includes("dominguez")) return "dominguez-auto-pintura";
  if (name.includes("wiltech")) return "wiltech";
  return slugifyClientName(client.company_name);
}

function slugifyClientName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

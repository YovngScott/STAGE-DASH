import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Server,
  Globe2,
  Loader2,
  Copy,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/webapps")({
  component: WebApps,
});

interface WebApp {
  id: string;
  name: string;
  url: string | null;
  hosting_provider: string | null;
  tech_stack: string[] | null;
  status: string;
  monthly_hosting_cost: number;
  client_id: string | null;
}

interface Client {
  id: string;
  company_name: string;
}

interface WebTemplate { id: string; name: string; version: string; description: string; }
interface WebDeployment {
  id: string; client_id: string; template_id: string; state: string; progress: number; phase: string;
  config: { companyName?: string }; public_url: string | null; error: string | null; previous_release: string | null;
}
interface FactoryPlatform { ready: boolean; plan: string | null; projectCount: number; projectLimit: number | null; capacityAvailable: boolean; tokenExpiresAt: string | null; }

const emptyFactory = {
  clientId: "", templateId: "workshop-management", companyName: "", legalName: "", phone: "", email: "",
  address: "", country: "República Dominicana", currency: "DOP", timezone: "America/Santo_Domingo",
  brandPrimary: "#c62828", brandInk: "#172033", receiptLegalText: "",
  adminEmail: "", adminPin: "",
};

const emptyDraft = {
  name: "",
  url: "",
  hosting_provider: "Local",
  client_id: "none",
  tech_stack: "",
  status: "local",
  monthly_hosting_cost: 0,
};

const statusStyles: Record<string, string> = {
  local: "bg-primary/15 text-primary border-primary/30",
  live: "bg-success/15 text-success border-success/30",
  maintenance: "bg-warning/15 text-warning border-warning/30",
  offline: "bg-destructive/15 text-destructive border-destructive/30",
};

function WebApps() {
  const [apps, setApps] = useState<WebApp[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WebApp | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [confirmDelete, setConfirmDelete] = useState<WebApp | null>(null);
  const [saving, setSaving] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [templates, setTemplates] = useState<WebTemplate[]>([]);
  const [deployments, setDeployments] = useState<WebDeployment[]>([]);
  const [factory, setFactory] = useState({ ...emptyFactory });
  const [factorySaving, setFactorySaving] = useState(false);
  const [factoryPlatform, setFactoryPlatform] = useState<FactoryPlatform | null>(null);

  const factoryFetch = async (init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Tu sesión venció.");
    const response = await fetch("/api/webapp-factory", { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
    return body;
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, clientsRes, factoryRes] = await Promise.all([
      supabase
      .from("web_apps")
      .select("id,name,url,hosting_provider,tech_stack,status,monthly_hosting_cost,client_id")
      .order("created_at", { ascending: true }),
      supabase.from("clients").select("id,company_name").order("company_name"),
      factoryFetch().catch((factoryError) => ({ error: factoryError instanceof Error ? factoryError.message : String(factoryError), templates: [], deployments: [] })),
    ]);
    if (error) toast.error(error.message);
    else setApps((data ?? []) as WebApp[]);
    if (clientsRes.error) toast.error(clientsRes.error.message);
    else setClients((clientsRes.data ?? []) as Client[]);
    setTemplates((factoryRes.templates ?? []) as WebTemplate[]);
    setDeployments((factoryRes.deployments ?? []) as WebDeployment[]);
    setFactoryPlatform((factoryRes.platform ?? null) as FactoryPlatform | null);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!deployments.some((item) => ["queued", "running", "preflight", "rolling_back"].includes(item.state))) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [deployments]);

  const openFactory = () => {
    setFactory({ ...emptyFactory, clientId: clients[0]?.id ?? "", templateId: templates[0]?.id ?? "workshop-management" });
    setFactoryOpen(true);
  };

  const replicate = async () => {
    setFactorySaving(true);
    try {
      await factoryFetch({ method: "POST", body: JSON.stringify({ action: "replicate", input: factory }) });
      toast.success("Réplica iniciada. Stage creará repositorio, base, secretos, Fly y acceso automáticamente.");
      setFactoryOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar la réplica.");
    } finally { setFactorySaving(false); }
  };

  const rollback = async (id: string) => {
    try {
      await factoryFetch({ method: "POST", body: JSON.stringify({ action: "rollback", id }) });
      toast.success("Rollback verificado correctamente.");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falló el rollback."); }
  };

  const openNew = () => {
    setEditing(null);
    setDraft({ ...emptyDraft });
    setOpen(true);
  };
  const openEdit = (a: WebApp) => {
    setEditing(a);
    setDraft({
      name: a.name,
      url: a.url ?? "",
      hosting_provider: a.hosting_provider ?? "",
      client_id: a.client_id ?? "none",
      tech_stack: (a.tech_stack ?? []).join(", "),
      status: a.status,
      monthly_hosting_cost: Number(a.monthly_hosting_cost),
    });
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      url: draft.url.trim() || null,
      hosting_provider: draft.hosting_provider.trim() || null,
      client_id: draft.client_id === "none" ? null : draft.client_id,
      tech_stack: draft.tech_stack
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      status: draft.status,
      monthly_hosting_cost: Number(draft.monthly_hosting_cost) || 0,
    };
    const q = editing
      ? supabase.from("web_apps").update(payload).eq("id", editing.id)
      : supabase.from("web_apps").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Web app updated" : "Web app created");
    setOpen(false);
    void load();
  };

  const remove = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase
      .from("web_apps")
      .delete()
      .eq("id", confirmDelete.id);
    if (error) return toast.error(error.message);
    toast.success(`${confirmDelete.name} fue eliminada`);
    setConfirmDelete(null);
    void load();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Proyectos personalizados
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Aplicaciones web
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {apps.length} proyectos · administra y replica las aplicaciones de tus clientes desde aquí.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={openNew}><Plus className="h-4 w-4" /> Registrar existente</Button>
          <Button className="gap-2" onClick={openFactory}><Copy className="h-4 w-4" /> Replicar para nuevo cliente</Button>
        </div>
      </div>

      {factoryPlatform && !factoryPlatform.capacityAvailable && (
        <Card className="border-warning/35 bg-warning/5 p-4 text-sm">
          <p className="font-medium text-warning">Publicación de nuevas réplicas pausada</p>
          <p className="mt-1 text-muted-foreground">Supabase {factoryPlatform.plan || ""} utiliza {factoryPlatform.projectCount} de {factoryPlatform.projectLimit ?? "—"} proyectos. Puedes diseñar y probar plantillas; Stage no creará recursos hasta que exista capacidad.</p>
        </Card>
      )}

      {deployments.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {deployments.slice(0, 4).map((item) => (
            <Card key={item.id} className="border-border/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-medium">{item.config?.companyName || item.template_id}</p><p className="mt-1 text-xs text-muted-foreground">{item.phase}</p></div>
                <Badge variant="outline">{item.state}</Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${item.progress}%` }} /></div>
              {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
              <div className="mt-3 flex justify-end gap-2">
                {item.public_url && <Button size="sm" variant="outline" asChild><a href={item.public_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir</a></Button>}
                {item.previous_release && <Button size="sm" variant="outline" onClick={() => void rollback(item.id)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Rollback</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border/60 bg-card/40 py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando aplicaciones…
        </div>
      ) : apps.length === 0 ? (
        <Card className="border-dashed border-border/60 p-10 text-center">
          <p className="text-sm text-muted-foreground">Aún no hay aplicaciones web.</p>
          <Button className="mt-4 gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" /> Registrar la primera
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {apps.map((a) => (
            <Card
              key={a.id}
              className="border-border/60 p-6"
              style={{ background: "var(--gradient-card)" }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <Globe2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">
                      {a.name}
                    </h3>
                    {a.url && (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                      >
                        {a.url.replace(/^https?:\/\//, "")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={statusStyles[a.status] ?? statusStyles.live}
                >
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
                  {a.status}
                </Badge>
              </div>
              {a.tech_stack && a.tech_stack.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {a.tech_stack.map((s) => (
                    <Badge key={s} variant="secondary" className="font-normal">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  {a.hosting_provider || "Not set"}
                </span>
                <span className="font-mono font-medium">
                  ${Number(a.monthly_hosting_cost).toFixed(2)}/mo
                </span>
              </div>
              <div className="mt-4 flex justify-end gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openEdit(a)}
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setConfirmDelete(a)}
                  title="Eliminar"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Editar ${editing.name}` : "Nueva aplicación web"}
            </DialogTitle>
            <DialogDescription>Aplicación local o externa asociada con un cliente.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="w-name">Name</Label>
              <Input
                id="w-name"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-url">URL</Label>
              <Input
                id="w-url"
                type="url"
                placeholder="https://example.com"
                value={draft.url}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, url: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="w-host">Hosting provider</Label>
                <Input
                  id="w-host"
                  placeholder="Local, Cloudflare, VPS..."
                  value={draft.hosting_provider}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, hosting_provider: e.target.value }))
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
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="live">En línea</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Client</Label>
              <Select
                value={draft.client_id}
                onValueChange={(client_id) => setDraft((d) => ({ ...d, client_id }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Associate with a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-stack">Tech stack (comma separated)</Label>
              <Input
                id="w-stack"
                placeholder="Next.js, Supabase, Stripe"
                value={draft.tech_stack}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, tech_stack: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-cost">Monthly hosting cost (USD)</Label>
              <Input
                id="w-cost"
                type="number"
                min={0}
                step="0.01"
                value={draft.monthly_hosting_cost}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    monthly_hosting_cost: Number(e.target.value),
                  }))
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Guardar cambios" : "Crear aplicación"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={factoryOpen} onOpenChange={setFactoryOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Replicar plantilla para nuevo cliente</DialogTitle>
            <DialogDescription>Solo completa lo que cambia. Stage heredará módulos y seguridad, probará todo y publicará sin código.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2"><Label>Cliente</Label><Select value={factory.clientId} onValueChange={(value) => setFactory((current) => ({ ...current, clientId: value }))}><SelectTrigger><SelectValue placeholder="Elegir cliente" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.company_name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Plantilla</Label><Select value={factory.templateId} onValueChange={(value) => setFactory((current) => ({ ...current, templateId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name} · v{template.version}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-muted-foreground"><ShieldCheck className="mr-2 inline h-4 w-4 text-success" />Incluye casos, cotizaciones, piezas, inventario, citas, reportes, usuarios, landing, RLS, Storage, health checks y rollback.</div>
            <div className="grid gap-3 md:grid-cols-2">
              {([['companyName','Nombre comercial'],['legalName','Razón social'],['phone','Teléfono'],['email','Correo'],['address','Dirección'],['country','País'],['currency','Moneda'],['timezone','Zona horaria']] as const).map(([key,label]) => <div key={key} className="space-y-2"><Label>{label}</Label><Input type={key === 'email' ? 'email' : 'text'} value={factory[key]} onChange={(event) => setFactory((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
            </div>
            <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Color principal</Label><Input type="color" value={factory.brandPrimary} onChange={(event) => setFactory((current) => ({ ...current, brandPrimary: event.target.value }))} /></div><div className="space-y-2"><Label>Color de texto</Label><Input type="color" value={factory.brandInk} onChange={(event) => setFactory((current) => ({ ...current, brandInk: event.target.value }))} /></div></div>
            <div className="space-y-2"><Label>Texto legal del recibo</Label><Input value={factory.receiptLegalText} onChange={(event) => setFactory((current) => ({ ...current, receiptLegalText: event.target.value }))} /></div>
            <div className="rounded-lg border border-border/60 p-4"><p className="text-sm font-medium">Acceso inicial del cliente</p><p className="mt-1 text-xs text-muted-foreground">El correo queda como contacto del administrador. El PIN se usa para el primer acceso y no se almacena en Stage.</p><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Correo administrador</Label><Input type="email" value={factory.adminEmail} onChange={(event) => setFactory((current) => ({ ...current, adminEmail: event.target.value }))} /></div><div className="space-y-2"><Label>PIN inicial (4 dígitos)</Label><Input type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={factory.adminPin} onChange={(event) => setFactory((current) => ({ ...current, adminPin: event.target.value.replace(/\D/g, "").slice(0, 4) }))} /></div></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setFactoryOpen(false)}>Cancelar</Button><Button onClick={() => void replicate()} disabled={factorySaving}>{factorySaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />} Crear réplica</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar aplicación web?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name} se eliminará permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

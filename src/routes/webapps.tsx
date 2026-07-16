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

  const load = async () => {
    setLoading(true);
    const [{ data, error }, clientsRes] = await Promise.all([
      supabase
      .from("web_apps")
      .select("id,name,url,hosting_provider,tech_stack,status,monthly_hosting_cost,client_id")
      .order("created_at", { ascending: true }),
      supabase.from("clients").select("id,company_name").order("company_name"),
    ]);
    if (error) toast.error(error.message);
    else setApps((data ?? []) as WebApp[]);
    if (clientsRes.error) toast.error(clientsRes.error.message);
    else setClients((clientsRes.data ?? []) as Client[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

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
    toast.success(`${confirmDelete.name} deleted`);
    setConfirmDelete(null);
    void load();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Custom Projects
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Web Apps Showcase
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {apps.length} local projects · manage client web apps from this dashboard.
          </p>
        </div>
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> New web app
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border/60 bg-card/40 py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading web apps…
        </div>
      ) : apps.length === 0 ? (
        <Card className="border-dashed border-border/60 p-10 text-center">
          <p className="text-sm text-muted-foreground">No web apps yet.</p>
          <Button className="mt-4 gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" /> Add your first web app
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
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setConfirmDelete(a)}
                  title="Delete"
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
              {editing ? `Edit ${editing.name}` : "New web app"}
            </DialogTitle>
            <DialogDescription>Local or external web app associated with a client.</DialogDescription>
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
                    <SelectItem value="live">Live</SelectItem>
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
                {editing ? "Save changes" : "Create web app"}
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
            <AlertDialogTitle>Delete web app?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name} will be permanently removed.
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

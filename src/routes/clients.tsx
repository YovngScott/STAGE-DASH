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

export const Route = createFileRoute("/clients")({
  component: Clients,
});

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
}

interface Product {
  id: string;
  name: string;
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
};

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

  const load = async () => {
    setLoading(true);
    const [cRes, pRes] = await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: true }),
      supabase.from("products").select("id,name").order("name"),
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
    });
    setOpen(true);
  };

  const toggleService = (name: string) => {
    setDraft((d) => ({
      ...d,
      services: d.services.includes(name)
        ? d.services.filter((s) => s !== name)
        : [...d.services, name],
    }));
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
                <TableRow key={c.id} className="border-border/60">
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
                        onClick={() => openEdit(c)}
                        title="Edit client"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleActive(c)}
                        title={
                          c.status === "active"
                            ? "Pause client"
                            : "Reactivate client"
                        }
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmDelete(c)}
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

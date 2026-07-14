import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  Phone,
  Calendar,
  Bot,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export const Route = createFileRoute("/products")({
  component: Products,
});

export interface Product {
  id: string;
  name: string;
  category: string;
  description: string | null;
  status: string;
  monthly_cost: number;
}

const categoryIcon: Record<string, LucideIcon> = {
  messaging: MessageSquare,
  voice: Phone,
  virtual_assistant: Calendar,
  automation: Bot,
};

const statusStyles: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  draft: "bg-warning/15 text-warning border-warning/30",
  paused: "bg-muted text-muted-foreground border-border",
};

const emptyDraft = {
  name: "",
  category: "messaging",
  description: "",
  status: "active",
  monthly_cost: 0,
};

function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("id,name,category,description,status,monthly_cost")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    else setProducts((data ?? []) as Product[]);
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
  const openEdit = (p: Product) => {
    setEditing(p);
    setDraft({
      name: p.name,
      category: p.category,
      description: p.description ?? "",
      status: p.status,
      monthly_cost: Number(p.monthly_cost),
    });
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      category: draft.category,
      description: draft.description.trim() || null,
      status: draft.status,
      monthly_cost: Number(draft.monthly_cost) || 0,
    };
    const q = editing
      ? supabase.from("products").update(payload).eq("id", editing.id)
      : supabase.from("products").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Product updated" : "Product created");
    setOpen(false);
    void load();
  };

  const remove = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase
      .from("products")
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
            Bots Directory
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Proprietary AI Systems
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {products.length} products · manage your recurring service catalog.
          </p>
        </div>
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> New product
        </Button>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : products.length === 0 ? (
        <EmptyBlock onNew={openNew} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => {
            const Icon = categoryIcon[p.category] ?? Bot;
            return (
              <Card
                key={p.id}
                className="relative h-full overflow-hidden border-border/60 p-6"
                style={{ background: "var(--gradient-card)" }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className={statusStyles[p.status] ?? statusStyles.paused}
                  >
                    {p.status.replace("_", " ")}
                  </Badge>
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">
                  {p.name}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground capitalize">
                  {p.category.replace("_", " ")}
                </p>
                {p.description && (
                  <p className="mt-3 text-sm text-muted-foreground line-clamp-3">
                    {p.description}
                  </p>
                )}
                <div className="mt-5 flex items-end justify-between border-t border-border/60 pt-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Monthly price
                    </p>
                    <p className="mt-0.5 text-lg font-semibold">
                      ${Number(p.monthly_cost).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(p)}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmDelete(p)}
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New product"}
            </DialogTitle>
            <DialogDescription>
              Recurring AI service offered by Stage AI Labs.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, category: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="messaging">Messaging</SelectItem>
                    <SelectItem value="voice">Voice</SelectItem>
                    <SelectItem value="virtual_assistant">
                      Virtual Assistant
                    </SelectItem>
                    <SelectItem value="automation">Automation</SelectItem>
                  </SelectContent>
                </Select>
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
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-price">Monthly price (USD)</Label>
              <Input
                id="p-price"
                type="number"
                min={0}
                step="0.01"
                value={draft.monthly_cost}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    monthly_cost: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea
                id="p-desc"
                rows={3}
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create product"}
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
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name} will be permanently removed. Clients already
              subscribed to it will keep the service name in their record.
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

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-border/60 bg-card/40 py-16 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading products…
    </div>
  );
}

function EmptyBlock({ onNew }: { onNew: () => void }) {
  return (
    <Card className="border-dashed border-border/60 p-10 text-center">
      <p className="text-sm text-muted-foreground">No products yet.</p>
      <Button className="mt-4 gap-2" onClick={onNew}>
        <Plus className="h-4 w-4" /> Add your first product
      </Button>
    </Card>
  );
}

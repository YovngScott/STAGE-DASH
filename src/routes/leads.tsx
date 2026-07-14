import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Trash2,
  Loader2,
  UserPlus,
  MessageCircle,
  XCircle,
  Mail,
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

export const Route = createFileRoute("/leads")({
  component: Leads,
});

interface Lead {
  id: string;
  name: string;
  company: string | null;
  email: string;
  services: string[] | null;
  message: string | null;
  status: string;
  created_at: string;
}

const statusStyle: Record<string, string> = {
  new: "bg-primary/15 text-primary border-primary/30",
  contacted: "bg-warning/15 text-warning border-warning/30",
  converted: "bg-success/15 text-success border-success/30",
  dismissed: "bg-muted text-muted-foreground",
};

function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Lead | null>(null);
  const [converting, setConverting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setLeads((data ?? []) as Lead[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          l.name.toLowerCase().includes(query.toLowerCase()) ||
          (l.company ?? "").toLowerCase().includes(query.toLowerCase()) ||
          l.email.toLowerCase().includes(query.toLowerCase()),
      ),
    [leads, query],
  );

  const newCount = leads.filter((l) => l.status === "new").length;

  const setStatus = async (lead: Lead, status: string) => {
    const { error } = await supabase
      .from("leads")
      .update({ status })
      .eq("id", lead.id);
    if (error) return toast.error(error.message);
    toast.success(`${lead.company ?? lead.name} marked as ${status}`);
    void load();
  };

  const convertToClient = async (lead: Lead) => {
    setConverting(lead.id);
    const { error: insertError } = await supabase.from("clients").insert({
      company_name: lead.company || lead.name,
      contact_name: lead.name,
      email: lead.email,
      status: "active",
      mrr: 0,
      billing_cycle: "monthly",
      services: lead.services ?? [],
      notes: lead.message,
    });
    if (insertError) {
      setConverting(null);
      return toast.error(insertError.message);
    }
    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: "converted" })
      .eq("id", lead.id);
    setConverting(null);
    if (updateError) return toast.error(updateError.message);
    toast.success(`${lead.company ?? lead.name} converted to client`);
    void load();
  };

  const remove = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase
      .from("leads")
      .delete()
      .eq("id", confirmDelete.id);
    if (error) return toast.error(error.message);
    toast.success(`${confirmDelete.company ?? confirmDelete.name} deleted`);
    setConfirmDelete(null);
    void load();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Inbound Pipeline
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Leads
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {leads.length} inquiries · {newCount} awaiting review
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 w-56"
          />
        </div>
      </div>

      <Card className="border-border/60 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading leads…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead>Contact</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id} className="border-border/60 align-top">
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium">{l.company || l.name}</span>
                      {l.company && (
                        <span className="text-[11px] text-muted-foreground">
                          {l.name}
                        </span>
                      )}
                      <a
                        href={`mailto:${l.email}`}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Mail className="h-3 w-3" /> {l.email}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    {l.services && l.services.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {l.services.map((s) => (
                          <Badge key={s} variant="secondary" className="font-normal">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {l.message || "—"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusStyle[l.status] ?? statusStyle.new}
                    >
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
                      {l.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(l.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      {l.status === "new" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setStatus(l, "contacted")}
                          title="Mark as contacted"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {l.status !== "converted" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={converting === l.id}
                          onClick={() => convertToClient(l)}
                          title="Convert to client"
                        >
                          {converting === l.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <UserPlus className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {l.status !== "dismissed" && l.status !== "converted" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setStatus(l, "dismissed")}
                          title="Dismiss"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmDelete(l)}
                        title="Delete"
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
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {leads.length === 0
                      ? "No leads yet. New inquiries from the landing page will show up here."
                      : "No leads match your search."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.company ?? confirmDelete?.name} will be permanently removed from the
              pipeline.
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

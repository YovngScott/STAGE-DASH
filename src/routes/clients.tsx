import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Edit3, Power, Settings2, Search } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/clients")({
  component: Clients,
});

interface Client {
  id: string;
  name: string;
  services: string[];
  status: "Active" | "Paused";
  billing: number;
  billingDay: number;
  since: string;
}

const initial: Client[] = [
  {
    id: "wiltech",
    name: "Wiltech",
    services: ["Stage Messaging Agent", "Stage Virtual Assistant"],
    status: "Active",
    billing: 350,
    billingDay: 5,
    since: "Mar 2026",
  },
  {
    id: "auto-repair",
    name: "Auto Repair Workshop",
    services: ["Custom Web App", "Stage Messaging Agent"],
    status: "Active",
    billing: 500,
    billingDay: 12,
    since: "May 2026",
  },
];

function Clients() {
  const [clients, setClients] = useState(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  const total = clients.reduce((s, c) => s + (c.status === "Active" ? c.billing : 0), 0);

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            B2B Accounts
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Client Manager</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {clients.length} clients · ${total.toLocaleString()} MRR contracted
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
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> Add New Client
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add new client</DialogTitle>
                <DialogDescription>
                  Onboard a B2B account and start billing.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const name = String(fd.get("name") || "").trim();
                  const billing = Number(fd.get("billing") || 0);
                  const day = Number(fd.get("day") || 1);
                  const svc = String(fd.get("services") || "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (!name) return;
                  setClients((c) => [
                    ...c,
                    {
                      id: crypto.randomUUID(),
                      name,
                      services: svc.length ? svc : ["Stage Messaging Agent"],
                      status: "Active",
                      billing,
                      billingDay: day,
                      since: "Jul 2026",
                    },
                  ]);
                  toast.success(`${name} added`);
                  setOpen(false);
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Client name</Label>
                  <Input id="name" name="name" placeholder="Acme Corp" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="services">Services (comma separated)</Label>
                  <Input
                    id="services"
                    name="services"
                    placeholder="Stage Messaging Agent, Custom Web App"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="billing">Monthly billing (USD)</Label>
                    <Input id="billing" name="billing" type="number" min={0} defaultValue={350} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="day">Billing day</Label>
                    <Input id="day" name="day" type="number" min={1} max={28} defaultValue={5} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">Save client</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead>Client</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead>Billing Day</TableHead>
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
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-medium">{c.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {c.services.map((s) => (
                      <Badge key={s} variant="secondary" className="font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      c.status === "Active"
                        ? "bg-success/15 text-success border-success/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  ${c.billing.toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {ordinal(c.billingDay)} of each month
                </TableCell>
                <TableCell className="text-muted-foreground">{c.since}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toast.info(`Edit billing for ${c.name}`)}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toast.info(`Toggle services for ${c.name}`)}
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setClients((cs) =>
                          cs.map((x) =>
                            x.id === c.id
                              ? { ...x, status: x.status === "Active" ? "Paused" : "Active" }
                              : x
                          )
                        );
                        toast.success(
                          `${c.name} ${c.status === "Active" ? "deactivated" : "reactivated"}`
                        );
                      }}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No clients match your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

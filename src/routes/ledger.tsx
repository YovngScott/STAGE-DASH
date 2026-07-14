import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, TrendingUp, Receipt, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/ledger")({
  component: Ledger,
});

type Kind = "investment" | "expense";

interface Tx {
  id: string;
  date: string;
  label: string;
  category: string;
  amount: number;
  kind: Kind;
  recurring?: boolean;
}

const seed: Tx[] = [
  { id: "1", date: "2026-01-08", label: "Company Formation · Wyoming LLC", category: "Legal", amount: 320, kind: "investment" },
  { id: "2", date: "2026-01-10", label: "Domain stage.ai purchase", category: "Domain", amount: 2400, kind: "investment" },
  { id: "3", date: "2026-01-22", label: "Development Infrastructure", category: "Infrastructure", amount: 1850, kind: "investment" },
  { id: "4", date: "2026-02-15", label: "Legal & registered agent (annual)", category: "Legal", amount: 410, kind: "investment" },
  { id: "5", date: "2026-03-01", label: "Initial capital injection", category: "Capital", amount: 7500, kind: "investment" },

  { id: "e1", date: "2026-07-01", label: "OpenAI API", category: "AI / LLM", amount: 106, kind: "expense", recurring: true },
  { id: "e2", date: "2026-07-01", label: "Supabase Pro", category: "Infrastructure", amount: 25, kind: "expense", recurring: true },
  { id: "e3", date: "2026-07-01", label: "Twilio (WhatsApp + Voice)", category: "Telephony", amount: 62, kind: "expense", recurring: true },
  { id: "e4", date: "2026-07-01", label: "Vapi / Retell", category: "Voice AI", amount: 45, kind: "expense", recurring: true },
  { id: "e5", date: "2026-07-01", label: "Vercel + Netlify hosting", category: "Hosting", amount: 40, kind: "expense", recurring: true },
  { id: "e6", date: "2026-07-01", label: "GitHub Team", category: "Software", amount: 21, kind: "expense", recurring: true },
  { id: "e7", date: "2026-07-01", label: "Gym membership", category: "Overhead", amount: 21, kind: "expense", recurring: true },
];

function Ledger() {
  const [txs, setTxs] = useState<Tx[]>(seed);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("expense");
  const [confirmDelete, setConfirmDelete] = useState<Tx | null>(null);

  const remove = () => {
    if (!confirmDelete) return;
    setTxs((prev) => prev.filter((t) => t.id !== confirmDelete.id));
    toast.success(`${confirmDelete.label} deleted`);
    setConfirmDelete(null);
  };

  const investments = useMemo(() => txs.filter((t) => t.kind === "investment"), [txs]);
  const expenses = useMemo(() => txs.filter((t) => t.kind === "expense"), [txs]);
  const totalInv = investments.reduce((s, t) => s + t.amount, 0);
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Investments & Expenses
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Financial Ledger</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Track personal capital injected and recurring operational costs.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log new transaction</DialogTitle>
              <DialogDescription>
                Record an investment or one-time / recurring expense.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const label = String(fd.get("label") || "").trim();
                const amount = Number(fd.get("amount") || 0);
                const category = String(fd.get("category") || "General");
                const date = String(fd.get("date") || new Date().toISOString().slice(0, 10));
                if (!label || amount <= 0) return;
                setTxs((prev) => [
                  { id: crypto.randomUUID(), date, label, amount, category, kind },
                  ...prev,
                ]);
                toast.success(`${kind === "investment" ? "Investment" : "Expense"} logged`);
                setOpen(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="investment">Investment</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Description</Label>
                <Input id="label" name="label" placeholder="e.g. OpenAI API top-up" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount (USD)</Label>
                  <Input id="amount" name="amount" type="number" min={0} step="0.01" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" name="category" placeholder="AI / LLM" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <DialogFooter>
                <Button type="submit">Save transaction</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          icon={TrendingUp}
          label="Total Investments"
          value={`$${totalInv.toLocaleString()}`}
          hint="Out-of-pocket capital deployed"
        />
        <SummaryCard
          icon={Receipt}
          label="Monthly Expenses"
          value={`$${totalExp.toLocaleString()}`}
          hint="Recurring API + operational costs"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Runway (at current burn)"
          value="8.2 months"
          hint="Includes MRR offset"
          accent
        />
      </div>

      <Tabs defaultValue="investments" className="w-full">
        <TabsList>
          <TabsTrigger value="investments">Investments</TabsTrigger>
          <TabsTrigger value="expenses">Operational Expenses</TabsTrigger>
        </TabsList>

        <TabsContent value="investments">
          <LedgerTable rows={investments} onDelete={setConfirmDelete} />
        </TabsContent>
        <TabsContent value="expenses">
          <LedgerTable rows={expenses} showRecurring onDelete={setConfirmDelete} />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.label} (${confirmDelete?.amount.toLocaleString()}) will be
              permanently removed from the ledger.
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

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Card
      className="border-border/60 p-5"
      style={accent ? { background: "var(--gradient-card)", boxShadow: "var(--shadow-elegant)" } : undefined}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function LedgerTable({
  rows,
  showRecurring,
  onDelete,
}: {
  rows: Tx[];
  showRecurring?: boolean;
  onDelete: (t: Tx) => void;
}) {
  return (
    <Card className="mt-4 border-border/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            {showRecurring && <TableHead>Cadence</TableHead>}
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id} className="border-border/60">
              <TableCell className="font-mono text-xs text-muted-foreground">{t.date}</TableCell>
              <TableCell className="font-medium">{t.label}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-normal">{t.category}</Badge>
              </TableCell>
              {showRecurring && (
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      t.recurring
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {t.recurring ? "Monthly" : "One-time"}
                  </Badge>
                </TableCell>
              )}
              <TableCell className="text-right font-mono font-medium">
                ${t.amount.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(t)}
                  title="Delete transaction"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={showRecurring ? 6 : 5}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                No transactions yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

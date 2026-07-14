import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Sparkles, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const { session, isOwner, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session && isOwner) {
      navigate({ to: "/" });
    }
  }, [loading, session, isOwner, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
    else toast.success("Signed in");
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signUp(email, password);
    setBusy(false);
    if (error) toast.error(error);
    else
      toast.success(
        "Account created. Grant yourself the 'owner' role in Supabase before signing in.",
      );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
          >
            <Sparkles className="h-5 w-5 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Stage AI Labs</h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Owner Console · Restricted Access
          </p>
        </div>

        {session && !isOwner && (
          <Card className="border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Access denied</p>
                <p className="mt-1 text-muted-foreground">
                  Your account is signed in but lacks the <code>owner</code> role.
                  Grant it in Supabase and reload:
                </p>
                <pre className="mt-2 overflow-x-auto rounded-md bg-background/60 p-2 text-[11px] font-mono">
{`INSERT INTO public.user_roles (user_id, role)
VALUES ('${session.user.id}', 'owner');`}
                </pre>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-6">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4">
              <form onSubmit={handleSignIn} className="space-y-4">
                <Field id="si-email" label="Email" type="email" value={email} onChange={setEmail} />
                <Field id="si-pass" label="Password" type="password" value={password} onChange={setPassword} />
                <Button type="submit" className="w-full gap-2" disabled={busy}>
                  <Lock className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4">
              <form onSubmit={handleSignUp} className="space-y-4">
                <Field id="su-email" label="Email" type="email" value={email} onChange={setEmail} />
                <Field id="su-pass" label="Password" type="password" value={password} onChange={setPassword} />
                <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
                  {busy ? "Creating…" : "Create account"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  After creating the account, insert a row in <code>user_roles</code> with
                  role <code>owner</code> to unlock the console.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete={type === "password" ? "current-password" : "email"}
      />
    </div>
  );
}

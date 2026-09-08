import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  isOwner: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

const KNOWN_OWNER_EMAILS = [
  "stage.labs@hotmail.com",
  "itssilverio032008@gmail.com",
  "josephsilverio9498@gmail.com",
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkOwner = async (userId: string | undefined, email?: string | null) => {
    const cleanEmail = (email ?? "").toLowerCase().trim();
    if (cleanEmail && KNOWN_OWNER_EMAILS.includes(cleanEmail)) {
      setIsOwner(true);
      return;
    }

    if (!userId) {
      setIsOwner(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "owner",
      });
      if (!error && Boolean(data)) {
        setIsOwner(true);
        return;
      }

      // Fallback a consulta directa sobre user_roles
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "owner")
        .maybeSingle();

      setIsOwner(roleRow?.role === "owner");
    } catch {
      setIsOwner(false);
    }
  };

  useEffect(() => {
    // Listener first — fires synchronously on subscribe with current session
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Defer role lookup — never call other supabase methods inside the callback synchronously
      setTimeout(() => {
        void checkOwner(s?.user.id, s?.user.email);
      }, 0);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void checkOwner(data.session?.user.id, data.session?.user.email).finally(() => setLoading(false));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthState["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp: AuthState["signUp"] = async (email, password) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setIsOwner(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isOwner,
        loading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

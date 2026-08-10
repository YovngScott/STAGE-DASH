import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppLanguage = "es" | "en";

const STORAGE_KEY = "stage-owner-language";

interface LanguageContextValue {
  language: AppLanguage;
  locale: "es-DO" | "en-US";
  setLanguage: (language: AppLanguage) => Promise<void>;
  text: (spanish: string, english: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function storedLanguage(): AppLanguage {
  if (typeof window === "undefined") return "es";
  return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "es";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("es");

  useEffect(() => {
    setLanguageState(storedLanguage());
    void supabase.auth.getUser().then(({ data }) => {
      const saved = data.user?.user_metadata?.app_language;
      if (saved === "es" || saved === "en") {
        setLanguageState(saved);
        window.localStorage.setItem(STORAGE_KEY, saved);
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      locale: language === "es" ? "es-DO" : "en-US",
      text: (spanish, english) => (language === "es" ? spanish : english),
      setLanguage: async (nextLanguage) => {
        const previousLanguage = language;
        setLanguageState(nextLanguage);
        window.localStorage.setItem(STORAGE_KEY, nextLanguage);

        const { error } = await supabase.auth.updateUser({
          data: { app_language: nextLanguage },
        });
        if (error) {
          setLanguageState(previousLanguage);
          window.localStorage.setItem(STORAGE_KEY, previousLanguage);
          throw error;
        }
      },
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}

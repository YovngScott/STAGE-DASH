import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Upload, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/website")({
  component: WebsiteContent,
});

interface HomeContent {
  hero: { eyebrow: string; title: string; subtitle: string; image_url: string };
  ethos: {
    eyebrow: string;
    title: string;
    cards: { tag: string; title: string; body: string }[];
  };
  cta: { title: string; subtitle: string };
}

interface ContactContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  quote: string;
  company_line: string;
}

interface Solution {
  slug: string;
  name: string;
  tagline: string;
  headline: string;
  intro: string;
  image_url: string;
  use_case_title: string;
  use_case_body: string;
  use_case_image_url: string;
  sort_order: number;
}

const defaultHome: HomeContent = {
  hero: { eyebrow: "", title: "", subtitle: "", image_url: "" },
  ethos: {
    eyebrow: "",
    title: "",
    cards: [
      { tag: "Mission", title: "", body: "" },
      { tag: "Vision", title: "", body: "" },
      { tag: "Values", title: "", body: "" },
    ],
  },
  cta: { title: "", subtitle: "" },
};

const defaultContact: ContactContent = {
  eyebrow: "",
  title: "",
  subtitle: "",
  quote: "",
  company_line: "",
};

async function uploadAsset(file: File, folder: string): Promise<string> {
  const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const { error } = await supabase.storage.from("site-assets").upload(path, file, {
    upsert: true,
  });
  if (error) throw error;
  return supabase.storage.from("site-assets").getPublicUrl(path).data.publicUrl;
}

function WebsiteContent() {
  const [loading, setLoading] = useState(true);
  const [home, setHome] = useState<HomeContent>(defaultHome);
  const [contact, setContact] = useState<ContactContent>(defaultContact);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [savingHome, setSavingHome] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [contentRes, solutionsRes] = await Promise.all([
      supabase.from("site_content").select("key,value").in("key", ["home", "contact"]),
      supabase.from("site_solutions").select("*").order("sort_order", { ascending: true }),
    ]);
    if (contentRes.error) toast.error(contentRes.error.message);
    else {
      const rows = contentRes.data ?? [];
      const homeRow = rows.find((r) => r.key === "home");
      const contactRow = rows.find((r) => r.key === "contact");
      if (homeRow) setHome({ ...defaultHome, ...(homeRow.value as Partial<HomeContent>) });
      if (contactRow) setContact({ ...defaultContact, ...(contactRow.value as Partial<ContactContent>) });
    }
    if (solutionsRes.error) toast.error(solutionsRes.error.message);
    else setSolutions((solutionsRes.data ?? []) as Solution[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const saveHome = async () => {
    setSavingHome(true);
    const { error } = await supabase
      .from("site_content")
      .upsert({ key: "home", value: home, updated_at: new Date().toISOString() });
    setSavingHome(false);
    if (error) return toast.error(error.message);
    toast.success("Home page updated");
  };

  const saveContact = async () => {
    setSavingContact(true);
    const { error } = await supabase
      .from("site_content")
      .upsert({ key: "contact", value: contact, updated_at: new Date().toISOString() });
    setSavingContact(false);
    if (error) return toast.error(error.message);
    toast.success("Contact page updated");
  };

  const saveSolution = async (s: Solution) => {
    setSavingSlug(s.slug);
    const { error } = await supabase
      .from("site_solutions")
      .update({
        name: s.name,
        tagline: s.tagline,
        headline: s.headline,
        intro: s.intro,
        image_url: s.image_url,
        use_case_title: s.use_case_title,
        use_case_body: s.use_case_body,
        use_case_image_url: s.use_case_image_url,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", s.slug);
    setSavingSlug(null);
    if (error) return toast.error(error.message);
    toast.success(`${s.name} updated`);
  };

  const handleUpload = async (
    key: string,
    file: File | undefined,
    onDone: (url: string) => void,
  ) => {
    if (!file) return;
    setUploadingKey(key);
    try {
      const url = await uploadAsset(file, key.split(":")[0]);
      onDone(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingKey(null);
    }
  };

  const updateSolution = (slug: string, patch: Partial<Solution>) => {
    setSolutions((prev) => prev.map((s) => (s.slug === slug ? { ...s, ...patch } : s)));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading website content…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Public Site
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          Website Content
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit the text and images shown on the public landing page. Changes go live immediately.
        </p>
      </div>

      <Tabs defaultValue="home" className="w-full">
        <TabsList>
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
          <TabsTrigger value="solutions">Solutions</TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="space-y-4 mt-4">
          <Card className="border-border/60 p-6 space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Hero</h3>
            <div className="space-y-2">
              <Label>Eyebrow</Label>
              <Input
                value={home.hero.eyebrow}
                onChange={(e) => setHome((h) => ({ ...h, hero: { ...h.hero, eyebrow: e.target.value } }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Textarea
                rows={2}
                value={home.hero.title}
                onChange={(e) => setHome((h) => ({ ...h, hero: { ...h.hero, title: e.target.value } }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Subtitle</Label>
              <Textarea
                rows={3}
                value={home.hero.subtitle}
                onChange={(e) => setHome((h) => ({ ...h, hero: { ...h.hero, subtitle: e.target.value } }))}
              />
            </div>
            <ImageField
              label="Background image"
              value={home.hero.image_url}
              uploadKey="home-hero"
              uploading={uploadingKey === "home-hero"}
              onUpload={(file) =>
                handleUpload("home-hero", file, (url) =>
                  setHome((h) => ({ ...h, hero: { ...h.hero, image_url: url } })),
                )
              }
            />
          </Card>

          <Card className="border-border/60 p-6 space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Ethos</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Eyebrow</Label>
                <Input
                  value={home.ethos.eyebrow}
                  onChange={(e) => setHome((h) => ({ ...h, ethos: { ...h.ethos, eyebrow: e.target.value } }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={home.ethos.title}
                  onChange={(e) => setHome((h) => ({ ...h, ethos: { ...h.ethos, title: e.target.value } }))}
                />
              </div>
            </div>
            {home.ethos.cards.map((card, i) => (
              <div key={card.tag} className="rounded-md border border-border/60 p-4 space-y-3">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{card.tag}</p>
                <Input
                  placeholder="Card title"
                  value={card.title}
                  onChange={(e) =>
                    setHome((h) => {
                      const cards = [...h.ethos.cards];
                      cards[i] = { ...cards[i], title: e.target.value };
                      return { ...h, ethos: { ...h.ethos, cards } };
                    })
                  }
                />
                <Textarea
                  rows={2}
                  placeholder="Card body"
                  value={card.body}
                  onChange={(e) =>
                    setHome((h) => {
                      const cards = [...h.ethos.cards];
                      cards[i] = { ...cards[i], body: e.target.value };
                      return { ...h, ethos: { ...h.ethos, cards } };
                    })
                  }
                />
              </div>
            ))}
          </Card>

          <Card className="border-border/60 p-6 space-y-4">
            <h3 className="text-sm font-semibold tracking-tight">Final call to action</h3>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={home.cta.title}
                onChange={(e) => setHome((h) => ({ ...h, cta: { ...h.cta, title: e.target.value } }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Subtitle</Label>
              <Textarea
                rows={2}
                value={home.cta.subtitle}
                onChange={(e) => setHome((h) => ({ ...h, cta: { ...h.cta, subtitle: e.target.value } }))}
              />
            </div>
          </Card>

          <div className="flex justify-end">
            <Button className="gap-2" onClick={saveHome} disabled={savingHome}>
              {savingHome ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save home page
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="contact" className="space-y-4 mt-4">
          <Card className="border-border/60 p-6 space-y-4">
            <div className="space-y-2">
              <Label>Eyebrow</Label>
              <Input
                value={contact.eyebrow}
                onChange={(e) => setContact((c) => ({ ...c, eyebrow: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={contact.title}
                onChange={(e) => setContact((c) => ({ ...c, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Subtitle</Label>
              <Textarea
                rows={3}
                value={contact.subtitle}
                onChange={(e) => setContact((c) => ({ ...c, subtitle: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Quote</Label>
              <Textarea
                rows={2}
                value={contact.quote}
                onChange={(e) => setContact((c) => ({ ...c, quote: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Company line</Label>
              <Input
                value={contact.company_line}
                onChange={(e) => setContact((c) => ({ ...c, company_line: e.target.value }))}
              />
            </div>
          </Card>

          <div className="flex justify-end">
            <Button className="gap-2" onClick={saveContact} disabled={savingContact}>
              {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save contact page
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="solutions" className="space-y-4 mt-4">
          {solutions.map((s) => (
            <Card key={s.slug} className="border-border/60 p-6 space-y-4">
              <h3 className="text-sm font-semibold tracking-tight">{s.name || s.slug}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={s.name} onChange={(e) => updateSolution(s.slug, { name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Tagline</Label>
                  <Input value={s.tagline} onChange={(e) => updateSolution(s.slug, { tagline: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Headline</Label>
                <Input value={s.headline} onChange={(e) => updateSolution(s.slug, { headline: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Intro</Label>
                <Textarea rows={3} value={s.intro} onChange={(e) => updateSolution(s.slug, { intro: e.target.value })} />
              </div>
              <ImageField
                label="Card / hero image"
                value={s.image_url}
                uploadKey={`solution-${s.slug}`}
                uploading={uploadingKey === `solution-${s.slug}`}
                onUpload={(file) =>
                  handleUpload(`solution-${s.slug}`, file, (url) => updateSolution(s.slug, { image_url: url }))
                }
              />
              <div className="space-y-2">
                <Label>Use case title</Label>
                <Input
                  value={s.use_case_title}
                  onChange={(e) => updateSolution(s.slug, { use_case_title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Use case body</Label>
                <Textarea
                  rows={3}
                  value={s.use_case_body}
                  onChange={(e) => updateSolution(s.slug, { use_case_body: e.target.value })}
                />
              </div>
              <ImageField
                label="Use case image"
                value={s.use_case_image_url}
                uploadKey={`usecase-${s.slug}`}
                uploading={uploadingKey === `usecase-${s.slug}`}
                onUpload={(file) =>
                  handleUpload(`usecase-${s.slug}`, file, (url) => updateSolution(s.slug, { use_case_image_url: url }))
                }
              />
              <div className="flex justify-end">
                <Button
                  className="gap-2"
                  onClick={() => saveSolution(s)}
                  disabled={savingSlug === s.slug}
                >
                  {savingSlug === s.slug ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save {s.name || s.slug}
                </Button>
              </div>
            </Card>
          ))}
          {solutions.length === 0 && (
            <Card className="border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              No solutions found. Run the supabase-site-content.sql migration from the landing
              repo to seed them.
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImageField({
  label,
  value,
  uploadKey,
  uploading,
  onUpload,
}: {
  label: string;
  value: string;
  uploadKey: string;
  uploading: boolean;
  onUpload: (file: File | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {value && (
          <img
            src={value}
            alt=""
            className="h-14 w-20 rounded object-cover border border-border/60"
          />
        )}
        <label className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs cursor-pointer hover:border-primary/40">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Uploading…" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            id={uploadKey}
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>
      </div>
    </div>
  );
}

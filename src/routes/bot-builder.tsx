import { createFileRoute } from "@tanstack/react-router";
import { CopilotChat } from "@/components/CopilotChat";

export const Route = createFileRoute("/bot-builder")({
  component: BotBuilderPage,
});

function BotBuilderPage() {
  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-[#07080c] py-2">
      {/* Luces de fondo sutiles y gradiente espacial */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-indigo-600/10 blur-[128px]" />
        <div className="absolute top-1/3 -right-20 h-96 w-96 rounded-full bg-violet-600/10 blur-[128px]" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-blue-600/5 blur-[96px]" />
      </div>

      {/* Contenido interactivo del Copiloto */}
      <div className="relative z-10 h-full">
        <CopilotChat />
      </div>
    </div>
  );
}

import type { OrderStatusTone, TimelineStep } from "@/lib/orderStatus";

function toneClass(tone: OrderStatusTone) {
  switch (tone) {
    case "success":
      return "border-green-700 bg-green-950/40 text-green-100";
    case "danger":
      return "border-red-700 bg-red-950/50 text-red-100";
    case "review":
      return "border-amber-700 bg-amber-950/40 text-amber-100";
    case "warning":
      return "border-orange-700 bg-orange-950/40 text-orange-100";
    case "active":
      return "border-sky-700 bg-sky-950/40 text-sky-100";
    case "waiting":
      return "border-[#30363d] bg-[#0d1117] text-gray-200";
    default:
      return "border-[#30363d] bg-[#0d1117] text-gray-300";
  }
}

function stepClass(state: TimelineStep["state"]) {
  switch (state) {
    case "done":
      return "border-green-600 bg-green-500";
    case "active":
      return "border-sky-500 bg-sky-500";
    case "failed":
      return "border-red-500 bg-red-500";
    case "review":
      return "border-amber-500 bg-amber-500";
    case "neutral":
      return "border-gray-500 bg-gray-600";
    default:
      return "border-[#30363d] bg-[#0d1117]";
  }
}

function textClass(state: TimelineStep["state"]) {
  if (state === "upcoming") return "text-gray-500";
  if (state === "failed") return "text-red-100";
  if (state === "review") return "text-amber-100";
  if (state === "neutral") return "text-gray-300";
  return "text-gray-100";
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: OrderStatusTone;
}) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClass(
        tone
      )}`}
    >
      {label}
    </span>
  );
}

export default function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="mt-4 grid gap-3">
      {steps.map((step) => (
        <div key={step.key} className="flex gap-3">
          <span
            className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${stepClass(
              step.state
            )}`}
          />
          <div>
            <div className={`text-sm font-semibold ${textClass(step.state)}`}>
              {step.label}
            </div>
            <div className="text-xs text-gray-400">{step.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

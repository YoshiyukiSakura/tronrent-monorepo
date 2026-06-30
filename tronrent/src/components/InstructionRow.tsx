"use client";

import React from "react";
import { FaCheck, FaCopy } from "react-icons/fa6";

export default function InstructionRow({
  label,
  value,
  copied = false,
  onCopy,
  tone = "default",
}: {
  label: string;
  value: string;
  copied?: boolean;
  onCopy?: () => void;
  tone?: "default" | "emphasis" | "warning";
}) {
  const toneClass =
    tone === "emphasis"
      ? "border-[#f05e23] bg-[#2a1b19]"
      : tone === "warning"
      ? "border-orange-800 bg-orange-950/40"
      : "border-[#30363d] bg-[#0d1117]";

  return (
    <div className={`mb-3 rounded-md border p-3 ${toneClass}`}>
      <div className="mb-1 text-xs text-gray-400">{label}</div>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 break-all font-mono text-sm">
          {value}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#1e2430] hover:bg-[#30363d]"
            aria-label={`复制${label}`}
            title={`复制${label}`}
          >
            {copied ? <FaCheck /> : <FaCopy />}
          </button>
        )}
      </div>
    </div>
  );
}

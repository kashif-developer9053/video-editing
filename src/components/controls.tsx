"use client";

/** Shared controls. Sized for fingers first — nothing below 44px tall. */

import { useState, type ReactNode } from "react";

export function Field({
  label,
  hint,
  help,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  help?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="flex items-baseline justify-between gap-2 text-sm font-medium text-ink"
      >
        <span>{label}</span>
        {hint ? (
          <b className="font-mono text-sm font-medium text-accent tabular-nums">{hint}</b>
        ) : null}
      </label>
      {children}
      {help ? <p className="text-xs leading-relaxed text-dim">{help}</p> : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-rule bg-panel2 px-3 py-3 text-base transition-colors " +
  "hover:border-rulehi focus:border-accent focus:outline-none disabled:opacity-40";

export function Select({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={inputClass}
    />
  );
}

export function Range({
  id,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="range"
      value={value}
      min={min}
      max={max}
      step={step ?? 1}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="py-2"
    />
  );
}

export function ColorInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-rule bg-panel2 px-3 py-2.5 transition-colors hover:border-rulehi"
    >
      <input
        id={id}
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 shrink-0 rounded border-0 bg-transparent"
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

export function Check({
  id,
  checked,
  onChange,
  children,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-muted select-none hover:text-ink"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 cursor-pointer accent-accent"
      />
      {children}
    </label>
  );
}

/**
 * A section that stays shut until someone wants it.
 *
 * Everything most people need is visible by default; the rest lives behind
 * one of these so the page is not a wall of controls on a phone.
 */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-panel2"
      >
        <span className="flex-1">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {summary ? <span className="mt-0.5 block text-xs text-dim">{summary}</span> : null}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-4 w-4 shrink-0 fill-none stroke-muted stroke-2 transition-transform ${open ? "rotate-180" : ""}`}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? <div className="flex flex-col gap-5 border-t border-rule px-4 py-4">{children}</div> : null}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-dim">{children}</p>;
}

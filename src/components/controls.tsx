"use client";

/** Small shared controls for the settings rail. */

import type { ReactNode } from "react";

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-rule px-[18px] py-4">
      <h3 className="flex items-center gap-2 font-display text-xs font-semibold tracking-[0.14em] text-dim uppercase">
        {title}
        <span aria-hidden className="h-px flex-1 bg-rule" />
      </h3>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="flex items-baseline justify-between gap-2 text-[11.5px] text-muted"
      >
        <span>{label}</span>
        {hint ? (
          <b className="font-mono text-[11.5px] font-medium text-accent tabular-nums">{hint}</b>
        ) : null}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded border border-rule bg-panel2 px-2.5 py-2 text-[13px] transition-colors " +
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
    />
  );
}

export function ColorInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="color"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded border border-rule bg-panel2 disabled:opacity-40"
    />
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
      className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-muted select-none hover:text-ink"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[15px] w-[15px] shrink-0 cursor-pointer accent-accent"
      />
      {children}
    </label>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-dim">{children}</p>;
}

import React, { CSSProperties } from "react";
import { color, font } from "@/theme";
import { useStore } from "@/state/store";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type BtnVariant = "primary" | "ghost" | "danger" | "mono";

const btnBase: CSSProperties = {
  borderRadius: 5,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: font.sans,
  lineHeight: 1.2,
};

export function Button({
  variant = "ghost",
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const variants: Record<BtnVariant, CSSProperties> = {
    primary: {
      border: `1px solid ${color.inkStrong}`,
      background: color.inkStrong,
      color: color.onDark,
      padding: "9px 15px",
      boxShadow: "inset 0 1px 0 rgba(255,247,230,.18)",
    },
    ghost: {
      border: `1px solid ${color.inkStrong}`,
      background: "transparent",
      color: color.inkStrong,
      padding: "9px 15px",
    },
    danger: {
      border: `1px solid ${color.danger}`,
      background: "transparent",
      color: color.danger,
      padding: "9px",
    },
    mono: {
      border: `1px solid ${color.border}`,
      background: color.panel,
      color: color.inkStrong,
      padding: "8px 13px",
      fontFamily: font.mono,
      fontSize: 12,
    },
  };
  return <button {...rest} style={{ ...btnBase, ...variants[variant], ...style }} />;
}

/** Two-state pill toggle (the design's Frameless/Face-frame style). */
export function Toggle({
  active,
  children,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      {...rest}
      style={{
        ...btnBase,
        border: `1px solid ${color.inkStrong}`,
        padding: "8px 14px",
        background: active ? color.inkStrong : "transparent",
        color: active ? color.onDark : color.inkStrong,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Stepper (− value +)                                                 */
/* ------------------------------------------------------------------ */

export function Stepper({
  value,
  onDec,
  onInc,
  min,
  max,
}: {
  value: number | string;
  onDec: () => void;
  onInc: () => void;
  min?: boolean;
  max?: boolean;
}) {
  const sBtn: CSSProperties = {
    border: "none",
    background: color.panel,
    padding: "7px 13px",
    fontSize: 16,
    cursor: "pointer",
    color: color.inkStrong,
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: `1px solid ${color.border}`,
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      <button style={{ ...sBtn, opacity: min ? 0.35 : 1 }} onClick={onDec} aria-label="decrease">
        −
      </button>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 14,
          minWidth: 30,
          textAlign: "center",
        }}
      >
        {value}
      </span>
      <button style={{ ...sBtn, opacity: max ? 0.35 : 1 }} onClick={onInc} aria-label="increase">
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Number field with free-form draft (commit on blur / Enter)          */
/* ------------------------------------------------------------------ */

export function NumberField({
  draftKey,
  value,
  onCommit,
  step = 0.125,
  style,
  align = "left",
}: {
  draftKey: string;
  value: number | string;
  onCommit: (raw: string) => void;
  step?: number;
  style?: CSSProperties;
  align?: "left" | "right";
}) {
  const draft = useStore((s) => s.drafts[draftKey]);
  const setDraft = useStore((s) => s.setDraft);
  const clearDraft = useStore((s) => s.clearDraft);
  return (
    <input
      type="number"
      step={step}
      value={draft !== undefined ? draft : value}
      onChange={(e) => setDraft(draftKey, e.target.value)}
      onBlur={(e) => {
        onCommit(e.target.value);
        clearDraft(draftKey);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{
        width: "100%",
        border: `1px solid ${color.border}`,
        background: color.panel,
        borderRadius: 5,
        padding: "8px 9px",
        fontSize: 14,
        textAlign: align,
        ...style,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Typographic helpers                                                 */
/* ------------------------------------------------------------------ */

export function MonoLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.18em",
        color: color.inkMuted,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontFamily: font.mono,
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: color.faint,
        marginBottom: 6,
      }}
    >
      {children}
    </label>
  );
}

export function Serif({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ fontFamily: font.serif, fontStyle: "italic", ...style }}>{children}</div>
  );
}

export function Divider({ style }: { style?: CSSProperties }) {
  return <div style={{ height: 1, background: color.divider, ...style }} />;
}

export function Swatch({ c, size = 13 }: { c: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 3,
        border: "1px solid rgba(31,20,14,.4)",
        background: c,
      }}
    />
  );
}

export function Select({
  style,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      style={{
        width: "100%",
        border: `1px solid ${color.border}`,
        background: color.panel,
        borderRadius: 5,
        padding: "9px 11px",
        fontSize: 14,
        cursor: "pointer",
        ...style,
      }}
    />
  );
}

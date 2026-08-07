import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ background: checked ? "var(--accent)" : "var(--control-hover)" }}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all"
        style={{ left: checked ? 18 : 2 }}
      />
    </button>
  );
}

export function Row({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-6 py-[7px]">
      <div className="min-w-0">
        <div className="text-[13px]">{title}</div>
        {subtitle && (
          <div className="mt-0.5 text-[12px]" style={{ color: "var(--text-2)" }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {title && (
        <div
          className="mb-1.5 px-1 text-[13px] font-semibold"
          style={{ color: "var(--text)" }}
        >
          {title}
        </div>
      )}
      <div
        className="divide-y rounded-[12px] border px-4"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
          // divider color
          ["--tw-divide-opacity" as any]: 1,
        }}
      >
        {React.Children.map(children, (child, i) => (
          <div
            style={{ borderColor: "var(--border)" }}
            className={i === 0 ? "" : "border-t"}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

/// Custom dropdown — a native <select> renders its option list with OS colors,
/// which is unreadable against the dark theme.
export function Select<T extends string>({
  value,
  options,
  onChange,
  width = 160,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const needed = Math.min(options.length, 8) * 30 + 12;
      setAbove(rect.bottom + needed > window.innerHeight && rect.top > needed);
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className="relative" style={{ width }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-left text-[13px]"
        style={{
          background: "var(--control)",
          borderColor: open ? "var(--accent)" : "var(--border)",
          color: "var(--text)",
        }}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown size={13} style={{ color: "var(--text-2)", flexShrink: 0 }} />
      </button>
      {open && (
        <div
          role="listbox"
          className="panel-shadow absolute z-50 max-h-[240px] w-full overflow-y-auto rounded-[10px] border py-1"
          style={{
            background: "var(--elevated)",
            borderColor: "var(--border)",
            backdropFilter: "blur(20px)",
            ...(above ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
          }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[13px]"
                style={{ color: "var(--text)" }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--control-hover)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "transparent")
                }
              >
                <span className="truncate">{o.label}</span>
                {active && <Check size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "destructive" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      background: "var(--control)",
      border: "1px solid var(--border)",
      color: "var(--text)",
    },
    primary: { background: "var(--accent)", color: "#fff" },
    destructive: { background: "var(--destructive)", color: "#fff" },
    ghost: { background: "transparent", color: "var(--accent)" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-85 disabled:opacity-40 ${className}`}
      style={styles[variant]}
    >
      {children}
    </button>
  );
}

export function SliderRow({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[140px]"
        style={{ accentColor: "var(--accent)" }}
      />
      <span
        className="w-10 text-right text-[12px] tabular-nums"
        style={{ color: "var(--text-2)" }}
      >
        {format ? format(value) : value}
      </span>
    </div>
  );
}

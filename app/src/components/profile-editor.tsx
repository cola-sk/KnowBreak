"use client";

import Link from "next/link";
import { useState } from "react";

import { PROFILE_DEFAULTS, type ColorTriple, type FieldSpec } from "@/lib/profile-defaults";

interface Props {
  initial: Record<string, unknown>;
}

function getNested(state: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = state;
  for (const part of parts) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setNested(state: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  const next = structuredClone(state) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function clearNested(state: Record<string, unknown>, key: string): Record<string, unknown> {
  const parts = key.split(".");
  const next = structuredClone(state) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      return next;
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[parts[parts.length - 1]];
  return next;
}

function formatDefault(spec: FieldSpec): string {
  if (spec.kind === "color") {
    const c = spec.default as ColorTriple;
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
  if (typeof spec.default === "boolean") {
    return spec.default ? "true" : "false";
  }
  return String(spec.default);
}

function defaultValueForField(spec: FieldSpec): unknown {
  if (spec.kind === "color") {
    const c = spec.default as ColorTriple;
    return [c.r, c.g, c.b];
  }
  return spec.default;
}

export function ProfileEditor({ initial }: Props) {
  const [state, setState] = useState<Record<string, unknown>>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      setMessage("已写入 profile_overrides.json，新跑的流水线会生效。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const resetField = (spec: FieldSpec) => {
    setState((prev) => clearNested(prev, spec.key));
  };

  const useDefault = (spec: FieldSpec) => {
    setState((prev) => setNested(prev, spec.key, defaultValueForField(spec)));
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {PROFILE_DEFAULTS.map((group) => (
        <section key={group.title} className="panel" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{group.title}</div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {group.fields.map((spec) => (
              <FieldRow
                key={spec.key}
                spec={spec}
                value={getNested(state, spec.key)}
                onChange={(value) => setState((prev) => setNested(prev, spec.key, value))}
                onClear={() => resetField(spec)}
                onUseDefault={() => useDefault(spec)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="panel" style={{ padding: 14 }}>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="approve-btn" disabled={saving} onClick={save}>
            {saving ? "保存中..." : "保存到 profile_overrides.json"}
          </button>
          {message ? <span className="badge approved">{message}</span> : null}
          {error ? <span className="badge rejected">{error}</span> : null}
        </div>
        <div style={{ marginTop: 8 }}>
          <Link className="tab " href="/">返回首页</Link>
          <Link className="tab " href="/projects">项目列表</Link>
        </div>
      </div>
    </div>
  );
}

interface FieldRowProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  onClear: () => void;
  onUseDefault: () => void;
}

function FieldRow({ spec, value, onChange, onClear, onUseDefault }: FieldRowProps) {
  const isOverridden = value !== undefined;
  const defaultHint = `默认: ${formatDefault(spec)}`;

  if (spec.kind === "bool") {
    const checked = typeof value === "boolean" ? value : Boolean(spec.default);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
          </div>
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          style={{ width: "auto" }}
        />
        {isOverridden ? <button className="tab " onClick={onClear}>清除覆盖</button> : <button className="tab " onClick={onUseDefault}>填入默认</button>}
      </div>
    );
  }

  if (spec.kind === "color") {
    const arr = Array.isArray(value) && value.length === 3
      ? (value as number[]).map((n) => Number(n))
      : (function () {
          const c = spec.default as ColorTriple;
          return [c.r, c.g, c.b];
        })();
    const handleChange = (idx: number, raw: string) => {
      const parsed = Number(raw);
      const next = [...arr] as number[];
      next[idx] = Number.isFinite(parsed) ? Math.max(0, Math.min(255, Math.round(parsed))) : 0;
      onChange(next);
    };
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <code>{spec.key}</code> · {defaultHint}
          </div>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          {(["R", "G", "B"] as const).map((label, idx) => (
            <div key={label} style={{ display: "grid", gap: 2, maxWidth: 90 }}>
              <label style={{ fontSize: 11, color: "var(--muted)" }}>{label}</label>
              <input
                type="number"
                min={0}
                max={255}
                value={arr[idx]}
                onChange={(event) => handleChange(idx, event.target.value)}
                style={{ maxWidth: 90 }}
              />
            </div>
          ))}
          <span className="badge" style={{ background: `rgb(${arr[0]}, ${arr[1]}, ${arr[2]})`, color: arr[0] + arr[1] + arr[2] > 384 ? "#000" : "#fff", border: "1px solid var(--line)" }}>
            {arr.join(",")}
          </span>
          {isOverridden ? <button className="tab " onClick={onClear}>清除</button> : null}
        </div>
      </div>
    );
  }

  const numValue = typeof value === "number" ? String(value) : "";
  const strValue = typeof value === "string" ? value : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
      <div>
        <label style={{ fontSize: 13, fontWeight: 500 }}>{spec.label}</label>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          <code>{spec.key}</code> · {defaultHint}{spec.hint ? ` · ${spec.hint}` : ""}
        </div>
      </div>
      <input
        type={spec.kind === "string" ? "text" : "number"}
        step={spec.kind === "float" ? "0.01" : "1"}
        value={spec.kind === "string" ? strValue : numValue}
        placeholder={formatDefault(spec)}
        onChange={(event) => {
          if (spec.kind === "string") {
            onChange(event.target.value);
            return;
          }
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        style={{ maxWidth: 180 }}
      />
      {isOverridden ? <button className="tab " onClick={onClear}>清除</button> : <button className="tab " onClick={onUseDefault}>默认</button>}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  effectiveTtsSettings,
  labelForTtsSettings,
  normalizeTtsSettings,
  saveTtsHistoryItem,
  TTS_PROVIDER_OPTIONS,
  ttsHistoryItemId,
  ttsHistoryKey,
  type ProjectRuntimeOverrides,
  type TtsHistoryItem,
  type TtsProvider,
  type TtsRuntimeDefaults,
} from "@/lib/tts-settings";

interface Props {
  value: ProjectRuntimeOverrides;
  defaults: TtsRuntimeDefaults;
  onChange: (next: ProjectRuntimeOverrides) => void;
  disabled?: boolean;
}

interface TtsSettingsEditorProps extends Props {
  clearLabel?: string;
  defaultLabel?: string;
}

export function overridesFromSettings(settings: TtsRuntimeDefaults): ProjectRuntimeOverrides {
  const normalized = normalizeTtsSettings(settings);
  return {
    tts: {
      provider: normalized.provider,
      model: normalized.model,
      speaker: normalized.speaker,
    },
  };
}

function readHistory(): TtsHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(ttsHistoryKey());
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is TtsHistoryItem =>
      item
      && typeof item.provider === "string"
      && typeof item.model === "string"
      && typeof item.speaker === "string"
      && typeof item.label === "string",
    );
  } catch {
    return [];
  }
}

export function TtsSettingsPanel({ value, defaults, onChange, disabled = false }: Props) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <TtsSettingsEditor
        value={value}
        defaults={defaults}
        onChange={onChange}
        disabled={disabled}
        clearLabel="恢复默认"
        defaultLabel="默认配置"
      />
    </div>
  );
}

export function TtsSettingsEditor({
  value,
  defaults,
  onChange,
  disabled = false,
  clearLabel = "清除 TTS 修改",
  defaultLabel = "默认配置",
}: TtsSettingsEditorProps) {
  const [history, setHistory] = useState<TtsHistoryItem[]>([]);
  const effective = effectiveTtsSettings(defaults, value);
  const currentId = ttsHistoryItemId(effective);
  const normalizedProvider = normalizeTtsSettings(effective).provider;
  const providerMeta = TTS_PROVIDER_OPTIONS.find((item) => item.value === normalizedProvider) ?? TTS_PROVIDER_OPTIONS[0];
  const hasOverrides = Boolean(value.tts?.provider || value.tts?.model || value.tts?.speaker);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  const options = useMemo(() => {
    const defaultItem: TtsHistoryItem = {
      ...defaults,
      label: labelForTtsSettings(defaults),
      lastUsedAt: "",
    };
    const merged = [
      defaultItem,
      ...history.filter((item) => ttsHistoryItemId(item) !== ttsHistoryItemId(defaultItem)),
    ];
    if (!merged.some((item) => ttsHistoryItemId(item) === currentId)) {
      merged.push({
        ...effective,
        label: labelForTtsSettings(effective),
        lastUsedAt: "",
      });
    }
    return merged.slice(0, 21);
  }, [defaults, effective, history, currentId]);

  const commitSettings = (settings: TtsRuntimeDefaults, saveHistory = false) => {
    const normalized = normalizeTtsSettings(settings);
    onChange(overridesFromSettings(normalized));
    if (saveHistory) {
      saveTtsHistoryItem(normalized);
      setHistory(readHistory());
    }
  };

  return (
    <div className="tts-inline-editor">
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>TTS 语音设置</div>
        <div className="section-subtitle">当前：{labelForTtsSettings(effective)}</div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>配置</label>
        <select
          disabled={disabled}
          value={currentId}
          onChange={(event) => {
            if (event.target.value === ttsHistoryItemId(defaults)) {
              onChange({});
              return;
            }
            const selected = options.find((item) => ttsHistoryItemId(item) === event.target.value);
            if (selected) {
              commitSettings(selected);
            }
          }}
        >
          {options.map((item) => (
            <option key={ttsHistoryItemId(item)} value={ttsHistoryItemId(item)}>
              {ttsHistoryItemId(item) === ttsHistoryItemId(defaults) ? `${defaultLabel}: ` : ""}{labelForTtsSettings(item)}
            </option>
          ))}
        </select>
      </div>

      <div className="tts-config-form">
        <div>
          <label>provider</label>
          <select
            disabled={disabled}
            value={normalizedProvider}
            onChange={(event) => {
              const nextProvider = event.target.value as TtsProvider;
              commitSettings(normalizeTtsSettings({ provider: nextProvider, model: "", speaker: "" }));
            }}
          >
            {TTS_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>{providerMeta.modelLabel}</label>
          <input
            disabled={disabled}
            value={effective.model}
            onChange={(event) => commitSettings({ ...effective, model: event.target.value })}
          />
        </div>

        <div>
          <label>{providerMeta.speakerLabel}</label>
          <input
            disabled={disabled}
            value={effective.speaker}
            onChange={(event) => commitSettings({ ...effective, speaker: event.target.value })}
          />
        </div>
      </div>

      <div className="row">
        <button
          type="button"
          className="btn secondary-btn compact-btn"
          disabled={disabled}
          onClick={() => commitSettings(effective, true)}
        >
          保存为常用配置
        </button>
        <button type="button" className="btn secondary-btn compact-btn" disabled={disabled || !hasOverrides} onClick={() => onChange({})}>
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

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

function overridesFromSettings(settings: TtsRuntimeDefaults): ProjectRuntimeOverrides {
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
  const [history, setHistory] = useState<TtsHistoryItem[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const effective = effectiveTtsSettings(defaults, value);
  const currentId = ttsHistoryItemId(effective);

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

  const onAdvancedSave = (settings: TtsRuntimeDefaults) => {
    const normalized = normalizeTtsSettings(settings);
    onChange(overridesFromSettings(normalized));
    saveTtsHistoryItem(normalized);
    setHistory(readHistory());
    setAdvancedOpen(false);
  };

  return (
    <div className="panel" style={{ padding: 12, display: "grid", gap: 10 }}>
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
            const selected = options.find((item) => ttsHistoryItemId(item) === event.target.value);
            if (selected) {
              onChange(overridesFromSettings(selected));
            }
          }}
        >
          {options.map((item) => (
            <option key={ttsHistoryItemId(item)} value={ttsHistoryItemId(item)}>
              {labelForTtsSettings(item)}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <button type="button" className="secondary compact-btn" disabled={disabled} onClick={() => setAdvancedOpen(true)}>
          高级配置
        </button>
      </div>

      {advancedOpen ? (
        <TtsAdvancedModal
          initial={effective}
          disabled={disabled}
          onClose={() => setAdvancedOpen(false)}
          onSave={onAdvancedSave}
        />
      ) : null}
    </div>
  );
}

function TtsAdvancedModal({
  initial,
  disabled,
  onClose,
  onSave,
}: {
  initial: TtsRuntimeDefaults;
  disabled: boolean;
  onClose: () => void;
  onSave: (settings: TtsRuntimeDefaults) => void;
}) {
  const [draft, setDraft] = useState<TtsRuntimeDefaults>(initial);
  const normalizedProvider = normalizeTtsSettings(draft).provider;
  const previewSettings = normalizeTtsSettings(draft);
  const providerMeta = TTS_PROVIDER_OPTIONS.find((item) => item.value === normalizedProvider) ?? TTS_PROVIDER_OPTIONS[0];

  const updateDraft = (patch: Partial<TtsRuntimeDefaults>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="project-config-modal tts-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tts-config-title"
        style={{ maxWidth: 760 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-config-modal-head">
          <div>
            <div id="tts-config-title" className="section-title">TTS 高级配置</div>
            <div className="section-subtitle">{labelForTtsSettings(previewSettings)}</div>
          </div>
          <button type="button" className="btn secondary-btn compact-btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="project-config-modal-body tts-config-body">
          <div className="tts-config-form">
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>provider</label>
            <select
              disabled={disabled}
              value={normalizedProvider}
              onChange={(event) => {
                const nextProvider = event.target.value as TtsProvider;
                setDraft(normalizeTtsSettings({ provider: nextProvider, model: "", speaker: "" }));
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
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{providerMeta.modelLabel}</label>
            <input
              disabled={disabled}
              value={draft.model}
              onChange={(event) => updateDraft({ model: event.target.value })}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{providerMeta.speakerLabel}</label>
            <input
              disabled={disabled}
              value={draft.speaker}
              onChange={(event) => updateDraft({ speaker: event.target.value })}
            />
          </div>
          </div>

          <div className="tts-config-actions">
            <button
              type="button"
              className="btn primary-btn compact-btn"
              disabled={disabled}
              onClick={() => onSave(previewSettings)}
            >
              保存
            </button>
            <button type="button" className="btn secondary-btn compact-btn" disabled={disabled} onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

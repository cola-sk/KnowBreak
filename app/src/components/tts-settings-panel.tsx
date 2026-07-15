"use client";

import { useEffect, useMemo, useState } from "react";

import {
  effectiveImageSettings,
  effectiveTtsSettings,
  IMAGE_PROVIDER_OPTIONS,
  labelForTtsSettings,
  normalizeTtsSettings,
  saveTtsHistoryItem,
  TTS_PROVIDER_OPTIONS,
  ttsHistoryItemId,
  ttsHistoryKey,
  type ImageRuntimeDefaults,
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

interface ImageSettingsEditorProps {
  value: ProjectRuntimeOverrides;
  defaults: ImageRuntimeDefaults;
  onChange: (next: ProjectRuntimeOverrides) => void;
  disabled?: boolean;
  clearLabel?: string;
  defaultLabel?: string;
}

export function overridesFromSettings(settings: TtsRuntimeDefaults, speed?: number): ProjectRuntimeOverrides {
  const normalized = normalizeTtsSettings(settings);
  return {
    tts: {
      provider: normalized.provider,
      model: normalized.model,
      speaker: normalized.speaker,
      speed,
    },
  };
}

export function imageOverridesFromSettings(settings: ImageRuntimeDefaults): ProjectRuntimeOverrides {
  return {
    image: {
      providers: settings.providers,
      pollinationsModel: settings.pollinationsModel,
      cloudflareModel: settings.cloudflareModel,
      huggingfaceModel: settings.huggingfaceModel,
      huggingfaceBaseUrl: settings.huggingfaceBaseUrl,
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
    onChange(overridesFromSettings(normalized, value.tts?.speed));
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

        <div>
          <label>语速倍率</label>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="number"
              disabled={disabled}
              step={0.05}
              min={0.5}
              max={2}
              value={value.tts?.speed ?? 1}
              onChange={(event) => {
                const num = parseFloat(event.target.value);
                if (!isNaN(num) && num >= 0.5 && num <= 2) {
                  onChange({ ...value, tts: { ...value.tts, provider: effective.provider, model: effective.model, speaker: effective.speaker, speed: num } });
                }
              }}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>1.0 = 正常，1.15 = 加快 15%</span>
          </div>
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

export function ImageSettingsEditor({
  value,
  defaults,
  onChange,
  disabled = false,
  clearLabel = "清除图片修改",
  defaultLabel = "默认配置",
}: ImageSettingsEditorProps) {
  const effective = effectiveImageSettings(defaults, value);
  const hasOverrides = Boolean(
    value.image?.providers?.length
    || value.image?.pollinationsModel
    || value.image?.cloudflareModel
    || value.image?.huggingfaceModel
    || value.image?.huggingfaceBaseUrl,
  );

  const commitSettings = (settings: ImageRuntimeDefaults) => {
    onChange(imageOverridesFromSettings(settings));
  };

  const toggleProvider = (provider: string) => {
    const exists = effective.providers.includes(provider);
    let nextProviders = exists
      ? effective.providers.filter((item) => item !== provider)
      : [...effective.providers, provider];

    // Filter to only include valid options
    const validValues = new Set(IMAGE_PROVIDER_OPTIONS.map((o) => o.value));
    nextProviders = nextProviders.filter((p) => validValues.has(p as any));

    commitSettings({
      ...effective,
      providers: nextProviders.length > 0 ? nextProviders : defaults.providers,
    });
  };

  return (
    <div className="tts-inline-editor">
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>图片资源设置</div>
        <div className="section-subtitle">
          当前：KB_IMAGE_PROVIDERS={effective.providers.join(",") || "-"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>{defaultLabel}</label>
        <div className="image-provider-checklist">
          {IMAGE_PROVIDER_OPTIONS.map((option) => {
            const index = effective.providers.indexOf(option.value);
            const isSelected = index !== -1;
            return (
              <label
                key={option.value}
                className={`image-provider-option ${isSelected ? "active" : ""}`}
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={isSelected}
                  onChange={() => toggleProvider(option.value)}
                />
                {isSelected && (
                  <span className="provider-order-badge" title={`优先级：第 ${index + 1} 位`}>
                    {index + 1}
                  </span>
                )}
                <span>{option.label}</span>
                <span className={`badge ${option.kind === "search" ? "search" : "generate"}`}>
                  {option.kind === "search" ? "图库" : "生成"}
                </span>
              </label>
            );
          })}
        </div>
        <div className="section-subtitle">
          勾选的顺序决定优先级顺序（写入 <code>KB_IMAGE_PROVIDERS</code>）；未勾选的 provider 不会参与图片阶段。
        </div>
      </div>

      <div className="image-provider-groups">
        {/* Pollinations Card */}
        <div className={`image-provider-card ${effective.providers.includes("pollinations") ? "active" : "disabled"}`}>
          <div className="image-provider-card-header">
            <span className="image-provider-card-title">
              Pollinations AI
              <span className="badge generate">生成</span>
            </span>
            {effective.providers.includes("pollinations") ? (
              <span className="badge success" style={{ fontSize: 10, padding: "2px 6px" }}>已启用</span>
            ) : (
              <span className="badge" style={{ fontSize: 10, padding: "2px 6px" }}>未启用</span>
            )}
          </div>
          <div className="image-provider-card-fields">
            <div className="image-provider-field">
              <label>
                <span>绘画模型</span>
                <span className="image-provider-field-env-badge">KB_POLLINATIONS_IMAGE_MODEL</span>
              </label>
              <input
                disabled={disabled}
                value={effective.pollinationsModel}
                placeholder="可空，使用 Pollinations 默认"
                onChange={(event) => commitSettings({ ...effective, pollinationsModel: event.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Cloudflare Card */}
        <div className={`image-provider-card ${effective.providers.includes("cloudflare_workers") ? "active" : "disabled"}`}>
          <div className="image-provider-card-header">
            <span className="image-provider-card-title">
              Cloudflare Workers AI
              <span className="badge generate">生成</span>
            </span>
            {effective.providers.includes("cloudflare_workers") ? (
              <span className="badge success" style={{ fontSize: 10, padding: "2px 6px" }}>已启用</span>
            ) : (
              <span className="badge" style={{ fontSize: 10, padding: "2px 6px" }}>未启用</span>
            )}
          </div>
          <div className="image-provider-card-fields">
            <div className="image-provider-field">
              <label>
                <span>绘画模型</span>
                <span className="image-provider-field-env-badge">KB_CLOUDFLARE_IMAGE_MODEL</span>
              </label>
              <input
                disabled={disabled}
                value={effective.cloudflareModel}
                onChange={(event) => commitSettings({ ...effective, cloudflareModel: event.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Hugging Face Card */}
        <div className={`image-provider-card ${effective.providers.includes("huggingface") ? "active" : "disabled"}`}>
          <div className="image-provider-card-header">
            <span className="image-provider-card-title">
              Hugging Face
              <span className="badge generate">生成</span>
            </span>
            {effective.providers.includes("huggingface") ? (
              <span className="badge success" style={{ fontSize: 10, padding: "2px 6px" }}>已启用</span>
            ) : (
              <span className="badge" style={{ fontSize: 10, padding: "2px 6px" }}>未启用</span>
            )}
          </div>
          <div className="image-provider-card-fields">
            <div className="image-provider-field">
              <label>
                <span>绘画模型</span>
                <span className="image-provider-field-env-badge">KB_HUGGINGFACE_IMAGE_MODEL</span>
              </label>
              <input
                disabled={disabled}
                value={effective.huggingfaceModel}
                onChange={(event) => commitSettings({ ...effective, huggingfaceModel: event.target.value })}
              />
            </div>
            <div className="image-provider-field">
              <label>
                <span>API 基础 URL</span>
                <span className="image-provider-field-env-badge">KB_HUGGINGFACE_IMAGE_BASE_URL</span>
              </label>
              <input
                disabled={disabled}
                value={effective.huggingfaceBaseUrl}
                onChange={(event) => commitSettings({ ...effective, huggingfaceBaseUrl: event.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <button
          type="button"
          className="btn secondary-btn compact-btn"
          disabled={disabled || !hasOverrides}
          onClick={() => onChange({})}
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

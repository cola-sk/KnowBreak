import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  listTomlFiles,
  listWorkflows,
  readWorkflowDescription,
  readWorkflowId,
  resolveProjectRoot,
  type WorkflowSummary,
} from "@/lib/review-store";

const PROFILE_NAME = "serious_science";
const WORKFLOW_FILE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PROMPT_STAGES = new Set(["extract", "topics", "rewrite", "topic_seed", "script", "storyboard", "assets", "images"]);

export type PromptSourceType = "default" | "existing" | "custom";
export type WorkflowStorage = "builtin" | "custom" | "topics";

export interface PromptTemplate {
  name: string;
  path: string;
  sourceType: PromptSourceType;
  content: string;
}

export interface EditableCapability {
  prompt?: string;
  promptContent?: string;
  promptSourceType?: PromptSourceType;
  inputs: string[];
  outputs: string[];
  params: Record<string, string>;
}

export interface WorkflowDetail {
  id: string;
  displayName: string;
  description: string;
  steps: string[];
  capabilities: Record<string, EditableCapability>;
  path: string;
  isCustom: boolean;
  isTopic: boolean;
  isEditable: boolean;
}

export interface WorkflowSaveCapability {
  prompt?: string;
  promptPath?: string;
  sourceType?: PromptSourceType;
  promptContent?: string;
  inputs?: string[];
  outputs?: string[];
  params?: Record<string, unknown>;
}

export interface WorkflowSaveRequest {
  id?: string;
  displayName?: string;
  filePath?: string;
  path?: string;
  storage?: WorkflowStorage;
  description?: string;
  steps?: string[];
  capabilities?: Record<string, WorkflowSaveCapability>;
}

export interface WorkflowListPayload {
  workflows: WorkflowSummary[];
  availablePrompts: Record<string, PromptTemplate[]>;
}

function profileDir(profileName = PROFILE_NAME): string {
  return path.join(resolveProjectRoot(), "profiles", profileName);
}

function workflowsDir(profileName = PROFILE_NAME): string {
  return path.join(profileDir(profileName), "workflows");
}

function promptsDir(profileName = PROFILE_NAME): string {
  return path.join(profileDir(profileName), "prompts");
}

function assertSafeSegments(segments: string[]): void {
  if (segments.length === 0 || segments.some((segment) => !isSafeWorkflowSegment(segment))) {
    throw new Error("workflow 路径非法");
  }
}

function isSafeWorkflowSegment(segment: string): boolean {
  const value = segment.trim();
  return Boolean(value)
    && value === segment
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0");
}

function normalizeWorkflowPath(
  segments: string[],
  profileName = PROFILE_NAME,
): { cliName: string; filePath: string; isCustom: boolean; isTopic: boolean; isEditable: boolean } {
  assertSafeSegments(segments);
  const cliName = segments.join("/");
  const filePath = path.join(workflowsDir(profileName), `${cliName}.toml`);
  const root = workflowsDir(profileName);
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("workflow 路径越界");
  }
  const isCustom = segments[0] === "custom";
  const isTopic = segments[0] === "topics";
  return { cliName, filePath, isCustom, isTopic, isEditable: true };
}

function normalizePromptPath(promptPath: string, profileName = PROFILE_NAME): string {
  const normalized = promptPath.trim().split(path.win32.sep).join(path.posix.sep);
  if (!normalized.startsWith("prompts/") || !normalized.endsWith(".md") || normalized.includes("..")) {
    throw new Error(`prompt 路径非法: ${promptPath}`);
  }
  const filePath = path.join(profileDir(profileName), normalized);
  const rel = path.relative(promptsDir(profileName), filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`prompt 路径越界: ${promptPath}`);
  }
  return filePath;
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\"/g, "\"").replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}

function collectValue(lines: string[], startIndex: number, initial: string): { value: string; nextIndex: number } {
  const trimmed = initial.trim();
  const openSquare = (trimmed.match(/\[/g) ?? []).length;
  const closeSquare = (trimmed.match(/\]/g) ?? []).length;
  const openBrace = (trimmed.match(/\{/g) ?? []).length;
  const closeBrace = (trimmed.match(/\}/g) ?? []).length;
  if (openSquare <= closeSquare && openBrace <= closeBrace) {
    return { value: trimmed, nextIndex: startIndex };
  }

  const parts = [trimmed];
  let squareDepth = openSquare - closeSquare;
  let braceDepth = openBrace - closeBrace;
  let index = startIndex + 1;
  while (index < lines.length && (squareDepth > 0 || braceDepth > 0)) {
    const line = lines[index].trim();
    parts.push(line);
    squareDepth += (line.match(/\[/g) ?? []).length - (line.match(/\]/g) ?? []).length;
    braceDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    index += 1;
  }
  return { value: parts.join(" "), nextIndex: index - 1 };
}

function parseQuotedArray(value: string): string[] {
  const values: string[] = [];
  const regex = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    values.push(unescapeTomlString(match[1]));
  }
  return values;
}

function parseInlineParams(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  const body = value.trim().replace(/^\{/, "").replace(/\}$/, "");
  const regex = /([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    params[match[1]] = unescapeTomlString(match[2]);
  }
  return params;
}

function parseWorkflowToml(toml: string): Omit<WorkflowDetail, "path" | "isCustom" | "isTopic" | "isEditable"> {
  const id = readWorkflowId(toml) ?? "";
  const description = readWorkflowDescription(toml) ?? "";
  const steps: string[] = [];
  const capabilities: Record<string, EditableCapability> = {};
  const lines = toml.split(/\r?\n/);
  let currentCapability: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const capMatch = /^\[capabilities\.([A-Za-z0-9_-]+)\]$/.exec(line);
    if (capMatch) {
      currentCapability = capMatch[1];
      capabilities[currentCapability] = capabilities[currentCapability] ?? {
        inputs: [],
        outputs: [],
        params: {},
      };
      continue;
    }

    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!assignment) {
      continue;
    }
    const key = assignment[1];
    const collected = collectValue(lines, i, assignment[2]);
    const value = collected.value;
    i = collected.nextIndex;

    if (!currentCapability && key === "steps") {
      steps.splice(0, steps.length, ...parseQuotedArray(value));
      continue;
    }

    if (!currentCapability) {
      continue;
    }
    const capability = capabilities[currentCapability];
    if (key === "prompt") {
      const match = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
      capability.prompt = match ? unescapeTomlString(match[1]) : value;
    } else if (key === "inputs") {
      capability.inputs = parseQuotedArray(value);
    } else if (key === "outputs") {
      capability.outputs = parseQuotedArray(value);
    } else if (key === "params") {
      capability.params = parseInlineParams(value);
    }
  }

  return { id, displayName: id, description, steps, capabilities };
}

function promptSourceType(stage: string, promptPath: string | undefined, workflowPath: string): PromptSourceType | undefined {
  if (!promptPath) {
    return undefined;
  }
  const ownPromptPrefix = ownPromptDirForPath(workflowPath);
  if (ownPromptPrefix && promptPath.startsWith(`${ownPromptPrefix}/`)) {
    return "custom";
  }
  if (promptPath === `prompts/${stage}.md`) {
    return "default";
  }
  return promptPath.startsWith("prompts/custom/") ? "custom" : "existing";
}

function ownPromptDirForPath(workflowPath: string): string | null {
  if (workflowPath.startsWith("custom/")) {
    return `prompts/custom/${workflowPath.replace(/^custom\//, "")}`;
  }
  if (workflowPath.startsWith("topics/")) {
    return `prompts/topics/${workflowPath.replace(/^topics\//, "")}`;
  }
  if (!workflowPath.includes("/")) {
    return `prompts/custom/${workflowPath}`;
  }
  return null;
}

function promptDisplayName(promptPath: string): string {
  const withoutPrefix = promptPath.replace(/^prompts\//, "").replace(/\.md$/, "");
  if (!withoutPrefix.includes("/")) {
    return `系统默认 / ${withoutPrefix}`;
  }
  return withoutPrefix;
}

function hasPromptStage(stage: string): boolean {
  return PROMPT_STAGES.has(stage);
}

export async function listWorkflowPayload(profileName = PROFILE_NAME): Promise<WorkflowListPayload> {
  const [workflows, availablePrompts] = await Promise.all([
    listWorkflows(profileName),
    listAvailablePrompts(profileName),
  ]);
  return { workflows, availablePrompts };
}

export async function listAvailablePrompts(profileName = PROFILE_NAME): Promise<Record<string, PromptTemplate[]>> {
  const base = promptsDir(profileName);
  const templates: Record<string, PromptTemplate[]> = {};
  const files = await listMarkdownFiles(base);

  for (const file of files) {
    const relative = path.relative(profileDir(profileName), file).split(path.sep).join("/");
    const stage = path.basename(file, ".md");
    const sourceType: PromptSourceType = relative.startsWith(`prompts/custom/`)
      ? "custom"
      : relative === `prompts/${stage}.md`
        ? "default"
        : "existing";
    templates[stage] = templates[stage] ?? [];
    templates[stage].push({
      name: promptDisplayName(relative),
      path: relative,
      sourceType,
      content: await fs.readFile(file, "utf-8"),
    });
  }

  for (const stage of Object.keys(templates)) {
    templates[stage].sort((a, b) => {
      const order = { default: 0, existing: 1, custom: 2 };
      if (order[a.sourceType] !== order[b.sourceType]) {
        return order[a.sourceType] - order[b.sourceType];
      }
      return a.path.localeCompare(b.path);
    });
  }
  return templates;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function readWorkflowDetail(segments: string[], profileName = PROFILE_NAME): Promise<WorkflowDetail> {
  const { cliName, filePath, isCustom, isTopic, isEditable } = normalizeWorkflowPath(segments, profileName);
  if (!existsSync(filePath)) {
    throw new Error("workflow 不存在");
  }
  const parsed = parseWorkflowToml(await fs.readFile(filePath, "utf-8"));

  for (const [stage, capability] of Object.entries(parsed.capabilities)) {
    const sourceType = promptSourceType(stage, capability.prompt, cliName);
    capability.promptSourceType = sourceType;
    if (capability.prompt?.startsWith("prompts/")) {
      const promptFile = normalizePromptPath(capability.prompt, profileName);
      if (existsSync(promptFile)) {
        capability.promptContent = await fs.readFile(promptFile, "utf-8");
      }
    } else if (capability.prompt && sourceType === "custom") {
      capability.promptContent = capability.prompt;
    }
  }

  return {
    ...parsed,
    displayName: parsed.id,
    path: cliName,
    isCustom,
    isTopic,
    isEditable,
  };
}

export async function saveCustomWorkflow(body: WorkflowSaveRequest, profileName = PROFILE_NAME): Promise<WorkflowDetail> {
  return saveEditableWorkflow(body, profileName);
}

export async function saveEditableWorkflow(body: WorkflowSaveRequest, profileName = PROFILE_NAME): Promise<WorkflowDetail> {
  const original = body.path?.trim() ? normalizeExistingPath(body.path.trim()) : null;
  const initialTarget = normalizeSaveTarget(body);
  let target = initialTarget.slug
    ? initialTarget
    : {
        storage: initialTarget.storage,
        slug: await generateAvailableWorkflowSlug(initialTarget.storage, profileName),
      };
  if (!WORKFLOW_FILE_SLUG_RE.test(target.slug)) {
    const implicitRenameFromLegacyPath = Boolean(original) && !(body.filePath ?? "").trim();
    if (implicitRenameFromLegacyPath) {
      const originalStorage = original ? original.storage : initialTarget.storage;
      target = {
        storage: originalStorage,
        slug: await generateAvailableWorkflowSlug(originalStorage, profileName),
      };
    } else {
      throw new Error("workflow 文件名只能使用英文、数字、下划线或中划线，且必须以英文或数字开头");
    }
  }
  const steps = normalizeSteps(body.steps);
  const workflowPath = target.storage === "builtin" ? target.slug : `${target.storage}/${target.slug}`;
  const capabilities = normalizeCapabilities(workflowPath, steps, body.capabilities ?? {}, profileName);

  const workflow: WorkflowDetail = {
    id: (body.displayName ?? body.id ?? target.slug).trim(),
    displayName: (body.displayName ?? body.id ?? target.slug).trim(),
    description: (body.description ?? "").trim(),
    steps,
    capabilities,
    path: workflowPath,
    isCustom: target.storage === "custom",
    isTopic: target.storage === "topics",
    isEditable: true,
  };

  await writeOwnedPrompts(workflow, profileName);

  const filePath = workflowTomlFilePath(target.storage, target.slug, profileName);
  const originalFilePath = original ? workflowTomlFilePath(original.storage, original.slug, profileName) : null;
  const originalWorkflowPath = original
    ? original.storage === "builtin" ? original.slug : `${original.storage}/${original.slug}`
    : null;
  if (originalFilePath && originalFilePath !== filePath && existsSync(filePath)) {
    throw new Error(`目标 workflow 已存在: ${workflowPath}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeWorkflowToml(workflow), "utf-8");
  if (originalFilePath && originalFilePath !== filePath) {
    await fs.rm(originalFilePath, { force: true });
    if (originalWorkflowPath) {
      await removeOwnedPromptDir(originalWorkflowPath, profileName);
    }
  }

  return readWorkflowDetail(target.storage === "builtin" ? [target.slug] : [target.storage, target.slug], profileName);
}

function normalizeSaveTarget(body: WorkflowSaveRequest): { storage: WorkflowStorage; slug: string } {
  const rawId = (body.filePath ?? "").trim();
  const rawPath = body.path?.trim();
  if (rawPath && !rawId) {
    return normalizeExistingPath(rawPath);
  }

  if (rawId.startsWith("topics/")) {
    return { storage: "topics", slug: rawId.replace(/^topics\//, "") };
  }
  if (rawId.startsWith("custom/")) {
    return { storage: "custom", slug: rawId.replace(/^custom\//, "") };
  }
  return {
    storage: body.storage === "topics" ? "topics" : body.storage === "builtin" ? "builtin" : "custom",
    slug: rawId,
  };
}

function workflowTomlFilePath(storage: WorkflowStorage, slug: string, profileName: string): string {
  return storage === "builtin"
    ? path.join(workflowsDir(profileName), `${slug}.toml`)
    : path.join(workflowsDir(profileName), storage, `${slug}.toml`);
}

function randomWorkflowSlug(): string {
  return `workflow_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

async function generateAvailableWorkflowSlug(storage: WorkflowStorage, profileName: string): Promise<string> {
  for (let i = 0; i < 12; i += 1) {
    const slug = randomWorkflowSlug();
    if (!existsSync(workflowTomlFilePath(storage, slug, profileName))) {
      return slug;
    }
  }
  throw new Error("生成 workflow 文件名失败，请重试");
}

function normalizeExistingPath(rawPath: string): { storage: WorkflowStorage; slug: string } {
  const parts = rawPath.split("/");
  if (parts.length === 1) {
    return { storage: "builtin", slug: parts[0] };
  }
  if ((parts[0] === "custom" || parts[0] === "topics") && parts.length === 2) {
    return { storage: parts[0], slug: parts[1] };
  }
  throw new Error("只能保存根目录 workflow、custom/<id> 或 topics/<id> 工作流");
}

function normalizeSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) {
    throw new Error("steps 必须是数组");
  }
  const normalized = steps.map((step) => String(step).trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("workflow 至少需要一个阶段");
  }
  for (const step of normalized) {
    if (!/^[A-Za-z0-9_-]+$/.test(step)) {
      throw new Error(`stage 名称非法: ${step}`);
    }
  }
  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`params key 非法: ${key}`);
    }
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    params[key] = String(raw);
  }
  return params;
}

function normalizeCapabilities(
  workflowPath: string,
  steps: string[],
  input: Record<string, WorkflowSaveCapability>,
  profileName: string,
): Record<string, EditableCapability> {
  const capabilities: Record<string, EditableCapability> = {};
  for (const step of steps) {
    const source = input[step] ?? {};
    const capability: EditableCapability = {
      inputs: normalizeStringArray(source.inputs),
      outputs: normalizeStringArray(source.outputs),
      params: normalizeParams(source.params),
    };
    if (hasPromptStage(step)) {
      if (source.sourceType === "custom") {
        const ownPromptDir = ownPromptDirForPath(workflowPath);
        if (!ownPromptDir) {
          throw new Error("只有 custom/* 或 topics/* workflow 支持专属 Prompt 写入");
        }
        capability.prompt = `${ownPromptDir}/${step}.md`;
        capability.promptSourceType = "custom";
        capability.promptContent = source.promptContent ?? "";
      } else if (source.promptPath || source.prompt) {
        const promptPath = source.promptPath ?? source.prompt ?? "";
        normalizePromptPath(promptPath, profileName);
        capability.prompt = promptPath;
        capability.promptSourceType = source.sourceType ?? "existing";
      } else {
        capability.prompt = `prompts/${step}.md`;
        capability.promptSourceType = "default";
      }
    }
    capabilities[step] = capability;
  }
  return capabilities;
}

async function writeOwnedPrompts(workflow: WorkflowDetail, profileName: string): Promise<void> {
  const ownPromptDir = ownPromptDirForPath(workflow.path);
  if (ownPromptDir) {
    await fs.mkdir(path.join(profileDir(profileName), ownPromptDir), { recursive: true });
  }
  for (const [stage, capability] of Object.entries(workflow.capabilities)) {
    if (capability.promptSourceType !== "custom" || !capability.prompt) {
      continue;
    }
    const promptFile = normalizePromptPath(capability.prompt, profileName);
    await fs.mkdir(path.dirname(promptFile), { recursive: true });
    await fs.writeFile(promptFile, capability.promptContent ?? "", "utf-8");
    delete capability.promptContent;
  }
}

function serializeWorkflowToml(workflow: WorkflowDetail): string {
  const lines: string[] = [
    `id = "${escapeTomlString(workflow.id)}"`,
    `description = "${escapeTomlString(workflow.description)}"`,
    "",
    "steps = [",
    ...workflow.steps.map((step) => `  "${escapeTomlString(step)}",`),
    "]",
    "",
  ];

  for (const step of workflow.steps) {
    const capability = workflow.capabilities[step] ?? { inputs: [], outputs: [], params: {} };
    lines.push(`[capabilities.${step}]`);
    if (capability.prompt) {
      lines.push(`prompt = "${escapeTomlString(capability.prompt)}"`);
    }
    if (Object.keys(capability.params ?? {}).length > 0) {
      lines.push(`params = { ${Object.entries(capability.params)
        .map(([key, value]) => `${key} = "${escapeTomlString(value)}"`)
        .join(", ")} }`);
    }
    lines.push(`inputs = ${formatArray(capability.inputs ?? [])}`);
    lines.push(`outputs = ${formatArray(capability.outputs ?? [])}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatArray(values: string[]): string {
  return `[${values.map((value) => `"${escapeTomlString(value)}"`).join(", ")}]`;
}

async function removeOwnedPromptDir(workflowPath: string, profileName: string): Promise<void> {
  const ownPromptDir = ownPromptDirForPath(workflowPath);
  if (!ownPromptDir) {
    return;
  }
  await fs.rm(path.join(profileDir(profileName), ownPromptDir), { recursive: true, force: true });
}

export async function deleteEditableWorkflow(segments: string[], profileName = PROFILE_NAME): Promise<void> {
  const { cliName, filePath } = normalizeWorkflowPath(segments, profileName);
  if (!existsSync(filePath)) {
    throw new Error("workflow 不存在");
  }
  await fs.rm(filePath, { force: true });
  await removeOwnedPromptDir(cliName, profileName);
}

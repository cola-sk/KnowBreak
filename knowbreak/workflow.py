"""Configuration-driven workflow loading and execution plans."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class CapabilityConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str | None = None
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)


class WorkflowConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    description: str = ""
    steps: list[str]
    capabilities: dict[str, CapabilityConfig] = Field(default_factory=dict)


def load_workflow(profile_dir: Path, workflow_name: str) -> WorkflowConfig:
    path = profile_dir / "workflows" / f"{workflow_name}.toml"
    if not path.exists():
        raise FileNotFoundError(f"workflow 不存在: {path}")
    return WorkflowConfig.model_validate(tomllib.loads(path.read_text(encoding="utf-8")))


def write_workflow_plan(
    workflow: WorkflowConfig,
    *,
    profile_name: str,
    output_dir: Path,
) -> None:
    plan = {
        "workflow": workflow.id,
        "description": workflow.description,
        "profile": profile_name,
        "steps": [
            {
                "capability": step,
                "prompt": workflow.capabilities.get(step, CapabilityConfig()).prompt,
                "inputs": workflow.capabilities.get(step, CapabilityConfig()).inputs,
                "outputs": workflow.capabilities.get(step, CapabilityConfig()).outputs,
            }
            for step in workflow.steps
        ],
    }
    (output_dir / "workflow_plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

import { WorkflowEditor } from "@/components/workflow-editor";
import { listWorkflowPayload } from "@/lib/workflow-store";

export const runtime = "nodejs";

export default async function WorkflowsPage() {
  const { workflows, availablePrompts } = await listWorkflowPayload();

  return (
    <main className="shell">
      <div className="page-header">
        <div className="hero-eyebrow">Workflow Studio</div>
        <h1 className="hero-title">工作流配置</h1>
        <p className="hero-sub">
          组合阶段、配置参数，并为脚本、分镜或图片等阶段绑定默认、复用或自定义 Prompt。
        </p>
      </div>

      <WorkflowEditor initialWorkflows={workflows} initialPrompts={availablePrompts} />
    </main>
  );
}

import { ReviewUnavailable } from "@/components/review-unavailable";
import { ScriptReviewClient, type ScriptReviewPayload } from "@/components/script-review-client";
import { StageHeader } from "@/components/stage-header";
import { getStageData } from "@/lib/review-store";

interface Props {
  params: Promise<{ videoId: string; version: string }>;
}

export default async function ScriptReviewPage({ params }: Props) {
  const { videoId, version } = await params;
  try {
    const initial = (await getStageData(
      videoId,
      version,
      "script",
    )) as ScriptReviewPayload;
    const title = initial.artifact.scripts[0]?.title;
    return (
      <main className="shell">
        <StageHeader videoId={videoId} version={version} title={title} active="script" />
        <ScriptReviewClient videoId={videoId} version={version} initial={initial} />
      </main>
    );
  } catch (error) {
    return (
      <ReviewUnavailable
        videoId={videoId}
        version={version}
        active="script"
        stageLabel="脚本审核"
        error={error}
      />
    );
  }
}

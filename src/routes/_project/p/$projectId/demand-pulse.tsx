import { createFileRoute } from "@tanstack/react-router";
import { DemandPulsePage } from "@/client/features/demand-pulse/DemandPulsePage";

export const Route = createFileRoute("/_project/p/$projectId/demand-pulse")({
  component: DemandPulseRoute,
});

function DemandPulseRoute() {
  const { projectId } = Route.useParams();
  return <DemandPulsePage projectId={projectId} />;
}

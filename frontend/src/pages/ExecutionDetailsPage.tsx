import { useParams } from "react-router-dom";
import RunDeployment from "./RunDeployment";

export default function ExecutionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const executionId = id ? Number(id) : undefined;

  return <RunDeployment mode="execution" targetInstallationId={executionId} />;
}

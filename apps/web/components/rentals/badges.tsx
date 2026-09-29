import {
  CONTRACT_ALERT_LABELS,
  CONTRACT_STATUS_LABELS,
  type ContractAlert,
  type ContractStatus,
} from "@crm/shared/rentals";
import { Badge } from "@/components/ui/misc";

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const tone =
    status === "active"
      ? "success"
      : status === "renewed"
        ? "primary"
        : status === "terminated"
          ? "danger"
          : "neutral";
  return <Badge tone={tone}>{CONTRACT_STATUS_LABELS[status]}</Badge>;
}

export function ContractAlertBadges({ alerts }: { alerts: ContractAlert[] }) {
  return (
    <>
      {alerts.map((a) => (
        <Badge
          key={a}
          tone={
            a === "expired" || a === "adjustment_overdue"
              ? "danger"
              : a === "not_started"
                ? "outline"
                : "warning"
          }
        >
          {CONTRACT_ALERT_LABELS[a]}
        </Badge>
      ))}
    </>
  );
}

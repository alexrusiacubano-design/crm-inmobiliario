import { CHARGE_STATUS_LABELS, type ChargeStatus } from "@crm/shared/billing";
import { Badge } from "@/components/ui/misc";

export function ChargeStatusBadge({ status, daysLate }: { status: ChargeStatus; daysLate?: number }) {
  const tone =
    status === "paid"
      ? "success"
      : status === "overdue"
        ? "danger"
        : status === "partial"
          ? "warning"
          : "neutral";
  return (
    <Badge tone={tone}>
      {CHARGE_STATUS_LABELS[status]}
      {status === "overdue" && daysLate ? ` · ${daysLate} d` : ""}
    </Badge>
  );
}

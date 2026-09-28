import {
  ACQUISITION_STAGE_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_VISIBILITY_LABELS,
  PROPERTY_STATUS_LABELS,
  type AcquisitionStage,
  type DocumentStatus,
  type DocumentVisibility,
  type PropertyStatus,
} from "@crm/shared/property";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/misc";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "outline";

const PROPERTY_TONE: Record<PropertyStatus, Tone> = {
  draft: "outline",
  available: "primary",
  published: "success",
  negotiating: "warning",
  reserved: "warning",
  rented: "neutral",
  sold: "neutral",
  paused: "outline",
  withdrawn: "danger",
};

export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  return <Badge tone={PROPERTY_TONE[status]}>{PROPERTY_STATUS_LABELS[status]}</Badge>;
}

const STAGE_TONE: Record<AcquisitionStage, Tone> = {
  prospect: "outline",
  contacted: "primary",
  valuation: "primary",
  negotiation: "primary",
  authorization: "warning",
  captured: "success",
  published: "success",
  lost: "neutral",
};

export function AcquisitionStageBadge({ stage }: { stage: AcquisitionStage }) {
  return <Badge tone={STAGE_TONE[stage]}>{ACQUISITION_STAGE_LABELS[stage]}</Badge>;
}

const DOC_TONE: Record<DocumentStatus, Tone> = {
  valid: "success",
  pending: "warning",
  expired: "danger",
  archived: "neutral",
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <Badge tone={DOC_TONE[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>;
}

export function VisibilityBadge({ visibility }: { visibility: DocumentVisibility }) {
  if (visibility === "internal") return null;
  return (
    <Badge tone={visibility === "confidential" ? "danger" : "outline"}>
      <Lock className="size-3" aria-hidden />
      {DOCUMENT_VISIBILITY_LABELS[visibility]}
    </Badge>
  );
}

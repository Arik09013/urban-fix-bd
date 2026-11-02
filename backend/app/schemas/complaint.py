from datetime import datetime
from typing import Any, Dict, List, Optional, Literal

from pydantic import BaseModel, Field


class Location(BaseModel):
    area: str = Field(..., min_length=2, max_length=200, examples=["Main Market, Block C"])
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    source: Optional[Literal["photo_exif", "device_gps", "map_pin", "manual"]] = None
    confirmed: bool = False
    accuracy_meters: Optional[float] = Field(default=None, ge=0, le=100_000)
    captured_at: Optional[datetime] = None


class ComplaintCreate(BaseModel):
    description: str = Field(..., min_length=3, max_length=4000)
    location: Location
    category_hint: Optional[str] = Field(default=None, max_length=100)
    image_url: Optional[str] = Field(default=None, max_length=2000)
    image_quality: Optional[str] = Field(default="usable", pattern="^(usable|blurry|dark|missing)$", examples=["usable", "blurry", "dark", "missing"])
    reporter_name: Optional[str] = Field(default=None, max_length=100)
    reporter_contact: Optional[str] = Field(default=None, max_length=200)
    source_fingerprint: Optional[str] = Field(default=None, max_length=200)


class ComplaintStatusUpdate(BaseModel):
    status: str = Field(
        ...,
        pattern="^(Submitted|Needs Review|Assigned|Contractor Offer Sent|Acknowledged|In Progress|Resolution Submitted|Evidence Uploaded|Verification|Resolved|Reopened - Needs Review|Rejected)$",
        examples=["Assigned", "In Progress", "Resolved"],
    )
    note: Optional[str] = Field(default=None, max_length=1000)


class OfficerOverride(BaseModel):
    final_category: Optional[Literal["Road Infrastructure", "Waste Management", "Water Supply", "Drainage / Sewerage", "Street Lighting", "Public Infrastructure", "Other"]] = None
    final_severity: Optional[Literal["Critical", "High", "Medium", "Low"]] = None
    final_department: Optional[str] = Field(default=None, max_length=120)
    reason: str = Field(..., min_length=3, max_length=1000)


class AffectedTooCreate(BaseModel):
    source_fingerprint: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=1000)


class ResolutionEvidenceCreate(BaseModel):
    before_image_url: Optional[str] = Field(default=None, max_length=2000)
    after_image_url: str = Field(..., min_length=3, max_length=2000)
    gps_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    completion_note: str = Field(..., min_length=3, max_length=2000)
    uploaded_by: str = Field(default="field-team", max_length=120)


class CitizenVerificationCreate(BaseModel):
    fixed: bool
    note: Optional[str] = None


class ReporterVerificationCreate(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)
    outcome: Literal["fixed", "partially_fixed", "not_fixed", "cannot_verify"]
    note: Optional[str] = Field(default=None, max_length=1000)


class ResolutionApprovalCreate(BaseModel):
    stakeholder: str = Field(..., pattern="^(contractor|reporter|government)$")
    approved: bool = True
    note: Optional[str] = None


class ContractorRatingCreate(BaseModel):
    score: int = Field(..., ge=1, le=5)
    token: Optional[str] = Field(default=None, max_length=200)


class Complaint(BaseModel):
    complaint_id: str
    description: str
    location: Location
    image_url: Optional[str] = None
    category: str
    severity: str
    ai_category: Optional[str] = None
    ai_severity: Optional[str] = None
    ai_department: Optional[str] = None
    ai_reasoning: Optional[str] = None
    confidence: float
    summary: str
    department: str
    priority_score: int
    priority_breakdown: Dict[str, int]
    duplicate_count: int = 1
    affected_count: int = 1
    needs_review: bool = False
    review_reason: Optional[str] = None
    sla_minutes: int = 1440
    sla_due_at: Optional[datetime] = None
    sla_status: str = "On Track"
    recurring_count_90d: int = 0
    hotspot_warning: bool = False
    safety_flag: bool = False
    low_quality_image: bool = False
    missing_location: bool = False
    multi_issue_detected: bool = False
    public_reporter_visible: bool = False
    data_label: str = "Live"
    status: str = "Submitted"
    channel: str = "Portal"
    created_at: datetime
    updated_at: datetime
    final_decision: Optional[Dict[str, Any]] = None
    resolution_evidence: Optional[Dict[str, Any]] = None
    citizen_verification: Optional[Dict[str, Any]] = None
    status_history: List[Dict[str, Any]] = Field(default_factory=list)


class ComplaintList(BaseModel):
    complaints: List[Complaint]

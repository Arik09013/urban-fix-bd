from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class OfferCreate(BaseModel):
    complaint_id: str
    contractor_id: str
    work_type: str = Field(..., examples=["Pothole patch"])
    work_location_area: Optional[str] = None
    work_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    work_longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    budget_cap: int = Field(..., ge=0, le=100_000_000, examples=[18000])
    sla_hours: int = Field(..., ge=1, le=720, examples=[2])
    proof_required: str = Field(default="Before/after photo + GPS", max_length=1000)


class OfferStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(Accepted|In Progress|Proof Submitted|Approved|Rejected)$", examples=["Accepted", "In Progress", "Proof Submitted", "Approved"])
    note: Optional[str] = Field(default=None, max_length=1000)


class Offer(BaseModel):
    offer_id: str
    complaint_id: str
    contractor_id: str
    work_type: str
    work_location_area: Optional[str] = None
    work_latitude: Optional[float] = None
    work_longitude: Optional[float] = None
    budget_cap: int
    sla_hours: int
    proof_required: str
    status: str = "Sent"
    created_at: datetime
    updated_at: datetime

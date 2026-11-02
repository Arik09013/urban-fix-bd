from typing import List, Optional

from pydantic import BaseModel, Field


class ContractorCreate(BaseModel):
    name: str = Field(..., min_length=2)
    contact: str
    service_area: str
    skills: List[str]
    verification_id: Optional[str] = None


class Contractor(BaseModel):
    contractor_id: str
    name: str
    contact: str
    service_area: str
    skills: List[str]
    rating: float = 4.5
    completed_jobs: int = 0
    distance_km: float = 0
    verified: bool = False
    available: bool = True
    trust_score: int = 70

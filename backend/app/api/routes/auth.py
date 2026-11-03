from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
import hmac
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import SESSION_COOKIE, create_session, hash_password, optional_user, public_user, require_admin, require_user, token_hash, verify_password
from app.db.repository import civic_repo, now_utc, public_id

router = APIRouter(prefix="/api/auth", tags=["authentication"])
attempts: dict[str, deque] = defaultdict(deque)


class RegisterCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: str = Field(..., min_length=5, max_length=160)
    password: str = Field(..., min_length=8, max_length=128)
    phone: str = Field(default="", max_length=40)
    account_type: str = Field(default="youth", pattern="^(youth|contractor)$")
    service_area: str = Field(default="", max_length=160)
    skills: list[str] = Field(default_factory=list, max_length=20)
    payout_account_id: str = Field(default="", max_length=120)


class LoginCreate(BaseModel):
    email: str
    password: str


class OfficerCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: str = Field(..., min_length=5, max_length=160)
    password: str = Field(..., min_length=8, max_length=128)
    authority_id: str = Field(..., min_length=3, max_length=50)
    department: str = Field(..., min_length=2, max_length=120)
    active: bool = Field(default=True)


class DemoOfficerLogin(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)


DEMO_OFFICERS = [
    {
        "user_id": "OFF-CCC-01",
        "name": "Tariqul Islam (CCC)",
        "username": "officer.ccc",
        "email": "officer.ccc@urbanfix.bd",
        "role": "officer",
        "authority_id": "AUTH-CCC",
        "authority_name": "Chattogram City Corporation",
        "department": "Engineering Department (Road Maintenance)",
        "active": True,
    },
    {
        "user_id": "OFF-DNCC-01",
        "name": "Farhana Ahmed (DNCC)",
        "username": "officer.dncc",
        "email": "officer.dncc@urbanfix.bd",
        "role": "officer",
        "authority_id": "AUTH-DNCC",
        "authority_name": "Dhaka North City Corporation",
        "department": "Waste Management Department",
        "active": True,
    },
    {
        "user_id": "OFF-DSCC-01",
        "name": "Mahmudur Rahman (DSCC)",
        "username": "officer.dscc",
        "email": "officer.dscc@urbanfix.bd",
        "role": "officer",
        "authority_id": "AUTH-DSCC",
        "authority_name": "Dhaka South City Corporation",
        "department": "Engineering Department (Roads & Bridges)",
        "active": True,
    },
    {
        "user_id": "OFF-DWASA-01",
        "name": "Kamal Hossain (DWASA)",
        "username": "officer.dwasa",
        "email": "officer.dwasa@urbanfix.bd",
        "role": "officer",
        "authority_id": "AUTH-DWASA",
        "authority_name": "Dhaka WASA",
        "department": "Sewerage Operations Division",
        "active": True,
    },
]


async def ensure_demo_officers() -> None:
    for demo in DEMO_OFFICERS:
        existing = await civic_repo.find_one("users", "username", demo["username"])
        if not existing:
            salt, password_hash = hash_password(settings.demo_officer_default_password)
            user_doc = {
                "user_id": demo["user_id"],
                "name": demo["name"],
                "username": demo["username"],
                "email": demo["email"],
                "role": "officer",
                "authority_id": demo["authority_id"],
                "department": demo["department"],
                "active": demo["active"],
                "password_salt": salt,
                "password_hash": password_hash,
                "created_at": now_utc(),
                "updated_at": now_utc(),
            }
            await civic_repo.insert_one("users", user_doc)


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, max_age=7 * 24 * 60 * 60,
        httponly=True, secure=settings.environment == "production",
        samesite="lax", path="/",
    )


def rate_limit_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check_rate_limit(request: Request) -> None:
    key = rate_limit_key(request)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    while attempts[key] and attempts[key][0] < cutoff:
        attempts[key].popleft()
    if len(attempts[key]) >= 10:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")


def record_failed_attempt(request: Request) -> None:
    attempts[rate_limit_key(request)].append(datetime.now(timezone.utc))


def clear_failed_attempts(request: Request) -> None:
    attempts.pop(rate_limit_key(request), None)


@router.post("/register")
async def register(payload: RegisterCreate, request: Request, response: Response):
    check_rate_limit(request)
    email = payload.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        record_failed_attempt(request)
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if await civic_repo.find_one("users", "email", email):
        record_failed_attempt(request)
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    salt, password_hash = hash_password(payload.password)
    user = {
        "user_id": public_id("USR"), "name": payload.name.strip(), "email": email,
        "phone": payload.phone.strip(), "role": payload.account_type, "password_salt": salt,
        "password_hash": password_hash, "created_at": now_utc(), "updated_at": now_utc(),
        "payout_account_id": payload.payout_account_id.strip() or None,
    }
    await civic_repo.insert_one("users", user)
    if payload.account_type == "contractor":
        await civic_repo.insert_one("contractors", {
            "contractor_id": public_id("CTR"), "user_id": user["user_id"], "name": user["name"],
            "contact": user["phone"] or user["email"], "service_area": payload.service_area.strip(),
            "skills": [skill.strip() for skill in payload.skills if skill.strip()], "rating": 0,
            "rating_count": 0, "completed_jobs": 0, "distance_km": 0, "verified": False,
            "available": False, "trust_score": 45, "approval_status": "Pending Approval",
            "payout_account_id": payload.payout_account_id.strip() or None,
        })
    token, session = await create_session(user)
    clear_failed_attempts(request)
    set_session_cookie(response, token)
    return public_user({**user, "csrf_token": session["csrf_token"]})


@router.post("/login")
async def login(payload: LoginCreate, request: Request, response: Response):
    check_rate_limit(request)
    email = payload.email.strip().lower()
    is_admin_name = hmac.compare_digest(email, settings.admin_username.lower())
    is_admin_password = hmac.compare_digest(payload.password, settings.admin_password)
    if is_admin_name and is_admin_password:
        user = {"user_id": "ADMIN", "name": "UrbanFix Administrator", "email": email, "role": "admin"}
    else:
        user = await civic_repo.find_one("users", "email", email)
        if not user:
            user = await civic_repo.find_one("users", "username", email)
        if not user or not verify_password(payload.password, user["password_salt"], user["password_hash"]):
            record_failed_attempt(request)
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if user.get("role") == "officer" and not user.get("active", True):
            record_failed_attempt(request)
            raise HTTPException(status_code=403, detail="Officer account is inactive")
    token, session = await create_session(user)
    clear_failed_attempts(request)
    set_session_cookie(response, token)
    return public_user({**user, "csrf_token": session["csrf_token"]})


@router.get("/demo-officers")
async def list_demo_officers():
    """List available simulated demo authority officers for testing."""
    return [
        {
            "username": officer["username"],
            "name": officer["name"],
            "email": officer["email"],
            "authority_id": officer["authority_id"],
            "authority_name": officer["authority_name"],
            "department": officer["department"],
            "role": "officer",
            "active": officer["active"],
            "simulated": True,
        }
        for officer in DEMO_OFFICERS
    ]


@router.post("/demo-officer-login")
async def demo_officer_login(payload: DemoOfficerLogin, request: Request, response: Response):
    """Controlled simulated demo officer login without exposing credentials."""
    if settings.environment == "production":
        raise HTTPException(status_code=403, detail="Demo officer login is disabled in production")
    if not settings.allow_demo_officer_login:
        raise HTTPException(status_code=403, detail="Demo officer login is disabled. Set ALLOW_DEMO_OFFICER_LOGIN=true to enable in development.")
    username = payload.username.strip().lower()
    await ensure_demo_officers()
    user = await civic_repo.find_one("users", "username", username)
    if not user or user.get("role") != "officer":
        raise HTTPException(status_code=404, detail="Demo officer not found")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Officer account is inactive")
    token, session = await create_session(user)
    clear_failed_attempts(request)
    set_session_cookie(response, token)
    return public_user({**user, "csrf_token": session["csrf_token"]})


@router.post("/officers")
async def create_officer(payload: OfficerCreate, _admin: dict = Depends(require_admin)):
    """Provision a new authority officer account (restricted to administrators)."""
    username = payload.username.strip().lower()
    email = payload.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if await civic_repo.find_one("users", "email", email):
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    if await civic_repo.find_one("users", "username", username):
        raise HTTPException(status_code=409, detail="An account already exists for this username")
    from app.services.routing.registry import get_authority
    auth = get_authority(payload.authority_id)
    if not auth:
        raise HTTPException(status_code=422, detail=f"Authority '{payload.authority_id}' not found in registry")
    salt, password_hash = hash_password(payload.password)
    user = {
        "user_id": public_id("OFF"),
        "name": payload.name.strip(),
        "username": username,
        "email": email,
        "role": "officer",
        "authority_id": payload.authority_id,
        "department": payload.department.strip(),
        "active": payload.active,
        "password_salt": salt,
        "password_hash": password_hash,
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    await civic_repo.insert_one("users", user)
    return public_user(user)


@router.get("/me")
async def me(request: Request):
    user = await optional_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return public_user(user)


@router.post("/logout")
async def logout(request: Request, response: Response, _user: dict = Depends(require_user)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await civic_repo.delete_one("sessions", "token_hash", token_hash(token))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"message": "Logged out"}

from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
import hmac
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import SESSION_COOKIE, create_session, hash_password, optional_user, public_user, require_user, token_hash, verify_password
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
        if not user or not verify_password(payload.password, user["password_salt"], user["password_hash"]):
            record_failed_attempt(request)
            raise HTTPException(status_code=401, detail="Invalid username or password")
    token, session = await create_session(user)
    clear_failed_attempts(request)
    set_session_cookie(response, token)
    return public_user({**user, "csrf_token": session["csrf_token"]})


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

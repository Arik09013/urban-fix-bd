from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.repository import civic_repo, now_utc, public_id
from app.core.security import require_user

router = APIRouter(prefix="/api/discussions", tags=["discussions"])


class DiscussionCreate(BaseModel):
    author_name: str = Field(default="Citizen", min_length=2, max_length=80)
    area: str = Field(..., min_length=2, max_length=160)
    topic: str = Field(..., min_length=3, max_length=120)
    message: str = Field(..., min_length=5, max_length=2000)


@router.get("")
async def list_discussions():
    posts = await civic_repo.list_all("discussions")
    return {"posts": sorted(posts, key=lambda item: item.get("created_at"), reverse=True)}


@router.post("")
async def create_discussion(payload: DiscussionCreate, user: dict = Depends(require_user)):
    post = {
        "post_id": public_id("DISC"),
        "author_name": user.get("name", "Citizen"),
        "author_user_id": user.get("user_id"),
        "area": payload.area,
        "topic": payload.topic,
        "message": payload.message,
        "upvotes": 0,
        "created_at": now_utc(),
    }
    return await civic_repo.insert_one("discussions", post)


@router.post("/{post_id}/upvote")
async def upvote_discussion(post_id: str, user: dict = Depends(require_user)):
    post = await civic_repo.find_one("discussions", "post_id", post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if await civic_repo.find_one("discussion_votes", "vote_key", f"{post_id}:{user['user_id']}"):
        raise HTTPException(status_code=409, detail="You already upvoted this post")
    await civic_repo.insert_one("discussion_votes", {"vote_key": f"{post_id}:{user['user_id']}", "post_id": post_id, "user_id": user["user_id"], "created_at": now_utc()})
    return await civic_repo.update_one("discussions", "post_id", post_id, {"upvotes": post.get("upvotes", 0) + 1})

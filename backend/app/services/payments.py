from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException

from app.core.config import settings


@dataclass
class PaymentReceipt:
    provider: str
    reference: str
    amount: int
    currency: str = "pkr"


async def release_contractor_payment(offer: dict, contractor: dict) -> PaymentReceipt:
    return await _release(
        reference=offer["offer_id"], amount=int(offer.get("budget_cap") or 0),
        destination=contractor.get("payout_account_id"),
        metadata={"offer_id": offer["offer_id"], "complaint_id": offer["complaint_id"]},
    )


async def release_community_payment(request: dict, applicant: dict) -> PaymentReceipt:
    return await _release(
        reference=request["request_id"], amount=int(request.get("approved_budget") or request.get("estimated_price") or 0),
        destination=applicant.get("payout_account_id"),
        metadata={"request_id": request["request_id"], "complaint_id": request["complaint_id"]},
    )


async def _release(*, reference: str, amount: int, destination: str | None, metadata: dict) -> PaymentReceipt:
    if amount <= 0:
        raise HTTPException(status_code=409, detail="A positive approved budget is required before payment")
    if settings.payment_provider == "demo":
        if settings.environment == "production":
            raise HTTPException(status_code=503, detail="A production payment provider is not configured")
        return PaymentReceipt("demo", f"demo-{reference}", amount)
    if settings.payment_provider != "stripe":
        raise HTTPException(status_code=503, detail="Unsupported payment provider")
    if not destination:
        raise HTTPException(status_code=409, detail="Recipient payout account is not configured")
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe payment credentials are unavailable")
    try:
        import stripe
        stripe.api_key = settings.stripe_secret_key
        transfer = stripe.Transfer.create(
            amount=amount * 100,
            currency="pkr",
            destination=destination,
            transfer_group=reference,
            metadata=metadata,
            # Preserve the original namespace so rebranding cannot duplicate a prior transfer.
            idempotency_key=f"civicpulse-release-{reference}",
        )
        return PaymentReceipt("stripe", transfer.id, amount)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Payment provider rejected the release; no approval was recorded") from exc

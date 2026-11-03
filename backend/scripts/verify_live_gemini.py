"""
Urban Fix BD - Live Gemini API Verification Script
Safe, minimal verification tool for gemini-3.5-flash-lite.
NEVER prints or logs API keys or headers.
"""
import asyncio
import os
import sys
import time
from io import BytesIO
from pathlib import Path
from PIL import Image

# Ensure backend directory is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.core.config import settings
from app.services.ai.gemini import analyze_complaint


def create_sample_civic_image() -> bytes:
    # Generates a minimal test image
    img = Image.new("RGB", (64, 64), color=(100, 100, 100))
    buffer = BytesIO()
    img.save(buffer, format="JPEG")
    return buffer.getvalue()


async def verify():
    print("=" * 60)
    print("URBAN FIX BD - LIVE GEMINI VERIFICATION")
    print("=" * 60)

    # 1. Check API Key Presence
    key = settings.gemini_api_key
    if not key or key == "your-gemini-api-key-here":
        print("[FAIL] GEMINI_API_KEY is not configured in backend/.env")
        print("Please configure your API key before running live verification.")
        return False

    print(f"[OK] API Key detected (Length: {len(key)} chars, not displayed)")
    print(f"[OK] Target Model: {settings.gemini_model}")

    # 2. Perform Single Multimodal Request
    test_image = create_sample_civic_image()
    print("[INFO] Sending single verification request with sample civic image...")
    start_time = time.time()

    result = await analyze_complaint(
        description="Pothole and road damage on main street",
        category_hint="Road Infrastructure",
        image_bytes=test_image,
        image_mime_type="image/jpeg",
    )
    elapsed = round(time.time() - start_time, 2)

    # 3. Inspect Result
    source = result.get("analysis_source")
    if source != "gemini-vision":
        warning = result.get("analysis_warning", "Unknown error")
        print(f"[FAIL] Live API request did not succeed (Fallback triggered: {warning})")
        return False

    print(f"[SUCCESS] Gemini response received in {elapsed}s")
    print(f"  - Source: {result.get('analysis_source')}")
    print(f"  - Visual Verification: {result.get('visual_verification')}")
    print(f"  - Category: {result.get('category')}")
    print(f"  - Severity: {result.get('severity')}")
    print(f"  - Confidence: {result.get('confidence')}")
    print(f"  - Is Civic Issue: {result.get('is_civic_issue')}")
    print(f"  - Summary: {result.get('summary')}")
    print(f"  - Department: {result.get('department')}")
    print("=" * 60)
    print("LIVE VERIFICATION COMPLETE - ALL CHECKS PASSED")
    print("=" * 60)
    return True


if __name__ == "__main__":
    success = asyncio.run(verify())
    sys.exit(0 if success else 1)

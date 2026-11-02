import re

STOPWORDS = {"the", "a", "an", "and", "or", "near", "outside", "issue", "reported", "citizen", "main"}


def rank_contractors(contractors: list[dict], complaint: dict) -> list[dict]:
    category = complaint.get("category", "").lower()
    issue_tokens = set(re.findall(r"[a-z0-9]+", f"{complaint.get('description', '')} {category}".lower())) - STOPWORDS

    def assessment(contractor: dict) -> tuple[float, list[str]]:
        skills_text = " ".join(contractor.get("skills", [])).lower()
        overlap = sorted(issue_tokens & set(re.findall(r"[a-z0-9]+", skills_text)))
        category_match = bool(category and category in skills_text)
        skill_points = 24 if category_match else min(len(overlap) * 4, 18)
        distance_km = max(float(contractor.get("distance_km", 50)), 0)
        score = skill_points + min(float(contractor.get("trust_score", 0)), 100) * .2 + min(float(contractor.get("rating", 0)), 5) * 4 + max(0, 16 - distance_km * 2)
        reasons = (["exact category capability"] if category_match else (["matching skills: " + ", ".join(overlap[:4])] if overlap else []))
        reasons += [f"{contractor.get('trust_score', 0)} trust score", f"{distance_km:g} km away"]
        return score, reasons

    ranked = []
    for contractor in contractors:
        if contractor.get("verified") is not True or contractor.get("available") is not True:
            continue
        score, reasons = assessment(contractor)
        ranked.append({**contractor, "match_score": round(score), "match_reasons": reasons})
    return sorted(ranked, key=lambda item: item["match_score"], reverse=True)

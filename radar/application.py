"""Normalize organizer-reviewed application facts and calculate difficulty."""
from .net import https_url

OPERATIONS = {"form", "email", "email-verify", "register", "follow", "repost",
              "like", "comment", "create-post", "quote-post", "link-accounts"}
SOCIAL = {"x", "instagram", "line", "facebook", "tiktok", "youtube"}
UNKNOWN_APPLICATION = dict(web_only=None, sns_required=None, platforms=[], operations=[],
                           free_registration=None, step_count=None, difficulty="unknown",
                           source_url=None, checked_at=None)


def application_profile(raw, free):
    if raw is None:
        return dict(UNKNOWN_APPLICATION)
    for key in ("web_only", "sns_required", "free_registration"):
        if raw[key] is not None and type(raw[key]) is not bool:
            raise ValueError(f"Invalid application flag: {key}")
    for key, allowed in (("platforms", SOCIAL), ("operations", OPERATIONS)):
        values = raw[key]
        if not isinstance(values, list) or len(set(values)) != len(values) or not set(values) <= allowed:
            raise ValueError(f"Invalid application {key}")
    if raw["platforms"] and raw["sns_required"] is not True:
        raise ValueError("Social platforms require a confirmed social requirement")
    https_url(raw["source_url"])
    operations = set(raw["operations"])
    count = len(raw["operations"]) or None
    difficulty = "unknown"
    if operations & {"create-post", "quote-post", "link-accounts"}:
        difficulty = "hard"
    elif free and raw["sns_required"] is False and raw["web_only"] is True and count and count <= 3:
        difficulty = "easy"
    elif free and raw["sns_required"] is True and operations <= {"follow", "repost", "like"} and count and count <= 2:
        difficulty = "easy"
    elif count:
        difficulty = "standard"
    return {**{key: raw[key] for key in ("web_only", "sns_required", "platforms", "operations",
                                         "free_registration", "source_url", "checked_at")},
            "step_count": count, "difficulty": difficulty}

"""Connect to the competition Workflow through a deployment-configured JSON gateway."""
import os
from urllib.parse import urlsplit

import httpx

from ..config import PLATFORM_MODE


def _https_url(key: str) -> str:
    value = os.environ.get(key, "").strip()
    try:
        url = urlsplit(value)
        return value if url.scheme == "https" and url.hostname and not url.username else ""
    except ValueError:
        return ""


def platform_enabled() -> bool:
    return PLATFORM_MODE == "teleagent"


def _workflow_settings() -> tuple[str, str]:
    return _https_url("SHZU_TELEAGENT_WORKFLOW_URL"), os.environ.get("SHZU_TELEAGENT_WORKFLOW_TOKEN", "").strip()


def platform_adapter_status() -> dict:
    endpoint, token = _workflow_settings()
    h5_url = _https_url("SHZU_TELEAGENT_H5_URL")
    return {
        "mode": PLATFORM_MODE,
        "workflow_configured": platform_enabled() and bool(endpoint and token),
        "h5_url": h5_url or None,
        "qr_url": (_https_url("SHZU_TELEAGENT_QR_URL") or None) if h5_url else None,
    }


class WorkflowError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def run_workflow(payload: dict, timeout: float) -> tuple[str, dict]:
    """Send one turn through the configured gateway. Use the upstream run ID verbatim."""
    endpoint, token = _workflow_settings()
    if not endpoint or not token:
        raise WorkflowError("platform_config")
    try:
        response = httpx.post(endpoint, json=payload, timeout=timeout,
                              headers={"Authorization": f"Bearer {token}"})
        response.raise_for_status()
        data = response.json()
    except httpx.TimeoutException as exc:
        raise TimeoutError from exc
    except httpx.HTTPError as exc:
        raise WorkflowError("platform_connection") from exc
    except ValueError as exc:
        raise WorkflowError("platform_response") from exc

    if not isinstance(data, dict):
        raise WorkflowError("platform_response")
    run_id = data.get("run_id")
    result = data.get("result")
    if not isinstance(run_id, str) or not run_id.strip() or not isinstance(result, dict):
        raise WorkflowError("platform_response")
    return run_id, result

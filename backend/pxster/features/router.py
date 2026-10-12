"""Authenticated, fail-closed reservations. These routes perform no feature actions."""
import json
import re
from pathlib import Path

from fastapi import Depends, HTTPException

MANIFEST = json.loads(Path(__file__).with_name("namespaces.json").read_text())


def capabilities():
    return {name: {"status": feature["status"], "enabled": False}
            for name, feature in MANIFEST["features"].items()}


def unavailable(feature):
    async def handler():
        raise HTTPException(501, detail={
            "code": "feature_not_implemented", "feature": feature,
            "message": "This namespace is reserved. No action was performed.",
        })
    return handler


def install_reserved_routes(app, current_user):
    occupied = {(method, route.path) for route in app.routes
                for method in getattr(route, "methods", [])}
    for name, feature in MANIFEST["features"].items():
        for route in feature["routes"]:
            key = (route["method"], route["path"])
            if key in occupied:
                raise RuntimeError(f"Reserved feature route collision: {key}")
            occupied.add(key)
            parameters = [{"name": p, "in": "path", "required": True,
                           "schema": {"type": "string"}}
                          for p in re.findall(r"\{(\w+)\}", route["path"])]
            app.add_api_route(
                route["path"], unavailable(name), methods=[route["method"]],
                dependencies=[Depends(current_user)],
                operation_id=route["operation_id"], tags=[f"Reserved: {name}"],
                summary=f"Reserved — {name} (not implemented)", status_code=501,
                responses={401: {"description": "Authentication required"},
                           501: {"description": "Reserved; no action performed"}},
                openapi_extra={"parameters": parameters, "x-pxster-status": "reserved"},
            )

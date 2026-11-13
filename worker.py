"""Cloudflare Python Workers ASGI entrypoint for the BunkBudget API."""

from workers import asgi

from main import app


Default = asgi.entrypoint(app)

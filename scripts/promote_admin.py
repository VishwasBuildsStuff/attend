"""Promote an existing BunkBudget user to the admin role."""

import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")
sys.path.insert(0, str(PROJECT_ROOT))

from models import User  # noqa: E402


def make_database_url():
    raw_url = os.getenv("DATABASE_URL")
    if not raw_url:
        raise ValueError("DATABASE_URL is not set in the project .env file")

    url = make_url(raw_url)
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+asyncpg")

    # Match the API's asyncpg handling of Neon/libpq connection parameters.
    query = dict(url.query)
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    url = url.set(query=query)
    connect_args = {"ssl": sslmode} if sslmode else {}
    return url, connect_args


async def promote_admin(email: str) -> bool:
    engine = None
    try:
        url, connect_args = make_database_url()
        engine = create_async_engine(url, pool_pre_ping=True, connect_args=connect_args)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            user = await session.scalar(
                select(User).where(func.lower(User.email) == email.lower())
            )
            if user is None:
                print(f"Failure: no user found with email {email}", file=sys.stderr)
                return False

            user.role = "admin"
            await session.commit()

        print(f"Success: {email} now has the admin role")
        return True
    except Exception as exc:
        print(f"Failure: could not promote {email}: {exc}", file=sys.stderr)
        return False
    finally:
        if engine is not None:
            await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email", help="email address of the user to promote")
    args = parser.parse_args()
    email = args.email.strip()
    if not email:
        parser.error("email must not be empty")
    return 0 if asyncio.run(promote_admin(email)) else 1


if __name__ == "__main__":
    raise SystemExit(main())

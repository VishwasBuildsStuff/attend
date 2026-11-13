"""BunkBudget authentication, attendance, and single-owner admin API."""

import os
import sys
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit
from uuid import UUID, uuid4

import asyncpg
import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from schemas import AdminStats, LoginRequest, SyncRequest, SubjectOutput, TokenResponse, UserCreate


# Local Uvicorn deployments use .env. Cloudflare Workers supply bindings through
# each ASGI request scope and do not have a project .env file.
if sys.platform != "emscripten":
    from dotenv import load_dotenv

    load_dotenv()

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
LOCAL_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

security = HTTPBearer(auto_error=False)
app = FastAPI(title="BunkBudget API", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def _binding_value(environment: Any, name: str) -> str | None:
    """Read a Cloudflare binding or a local process environment variable."""
    if environment is not None:
        try:
            value = getattr(environment, name)
        except (AttributeError, TypeError):
            try:
                value = environment[name]
            except (KeyError, TypeError):
                value = None
        if value is not None:
            return str(value)
    return os.getenv(name)


def _worker_environment(request: Request) -> Any | None:
    return request.scope.get("env")


def _secret_key(request: Request) -> str:
    key = _binding_value(_worker_environment(request), "SECRET_KEY") or os.getenv("JWT_SECRET")
    if not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API secret is not configured",
        )
    return key


def _admin_email(request: Request) -> str:
    return (_binding_value(_worker_environment(request), "ADMIN_EMAIL") or "").strip().lower()


def _jwt_algorithm(request: Request) -> str:
    return _binding_value(_worker_environment(request), "JWT_ALGORITHM") or JWT_ALGORITHM


async def _connect_local_database() -> asyncpg.Connection:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("Set DATABASE_URL in the project .env file.")

    # Parse Neon/libpq URLs into asyncpg arguments. asyncpg accepts ssl but not
    # libpq's sslmode or channel_binding query parameters.
    if dsn.startswith("postgresql+asyncpg://"):
        dsn = dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlsplit(dsn)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    connect_args: dict[str, Any] = {
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "database": unquote(parsed.path.lstrip("/")),
        "ssl": sslmode if sslmode in {"require", "verify-ca", "verify-full"} else None,
    }
    if "application_name" in query:
        connect_args["server_settings"] = {"application_name": query["application_name"]}
    return await asyncpg.connect(**connect_args)


async def _connect_database(request: Request) -> asyncpg.Connection:
    environment = _worker_environment(request)
    hyperdrive = None
    if environment is not None:
        try:
            hyperdrive = getattr(environment, "HYPERDRIVE")
        except (AttributeError, TypeError):
            try:
                hyperdrive = environment["HYPERDRIVE"]
            except (KeyError, TypeError):
                pass

    if hyperdrive is None:
        return await _connect_local_database()

    return await asyncpg.connect(
        host=str(hyperdrive.host),
        port=int(hyperdrive.port),
        user=str(hyperdrive.user),
        password=str(hyperdrive.password),
        database=str(hyperdrive.database),
        # Hyperdrive terminates TLS and provides its own pooled connection to Neon.
        ssl=False,
    )


async def get_db(request: Request) -> AsyncIterator[asyncpg.Connection]:
    try:
        connection = await _connect_database(request)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection is unavailable",
        ) from exc
    try:
        yield connection
    finally:
        await connection.close()


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


def create_access_token(user_id: UUID, request: Request) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=60)},
        _secret_key(request),
        algorithm=_jwt_algorithm(request),
    )


def decode_user_id(
    credentials: HTTPAuthorizationCredentials | None,
    request: Request,
) -> UUID:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = jwt.decode(
            credentials.credentials,
            _secret_key(request),
            algorithms=[_jwt_algorithm(request)],
            options={"require_sub": True, "require_exp": True},
        )
        return UUID(claims["sub"])
    except HTTPException:
        raise
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> UUID:
    return decode_user_id(credentials, request)


async def get_current_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    user_id = decode_user_id(credentials, request)
    user = await db.fetchrow(
        "SELECT id, email, role FROM users WHERE id = $1",
        user_id,
    )
    admin_email = _admin_email(request)
    if (
        user is None
        or not admin_email
        or user["role"] != "admin"
        or not user["email"]
        or user["email"].strip().lower() != admin_email
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return dict(user)


@app.post("/api/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    payload: UserCreate,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
) -> TokenResponse:
    usn = payload.usn.strip().upper()
    registration_number = payload.registration_number.strip().upper()
    duplicate = await db.fetchval(
        """
        SELECT id FROM users
        WHERE lower(usn) = lower($1)
           OR lower(registration_number) = lower($2)
           OR lower(email) = lower($3)
        LIMIT 1
        """,
        usn,
        registration_number,
        payload.email,
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this USN, registration number, or email",
        )

    user_id = uuid4()
    try:
        await db.execute(
            """
            INSERT INTO users (
                id, full_name, student_class, email, usn, registration_number,
                phone_number, role, hashed_password
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, 'student', crypt($8, gen_salt('bf', 12))
            )
            """,
            user_id,
            payload.full_name,
            payload.student_class,
            payload.email,
            usn,
            registration_number,
            payload.phone_number,
            payload.password,
        )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this USN, registration number, or email",
        ) from exc

    return TokenResponse(access_token=create_access_token(user_id, request))


@app.post("/api/login", response_model=TokenResponse)
async def login_user(
    payload: LoginRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
) -> TokenResponse:
    identifier = payload.identifier.strip().lower()
    users = await db.fetch(
        """
        SELECT id, hashed_password,
               replace(hashed_password, '$2b$', '$2a$') = crypt(
                   $1,
                   replace(hashed_password, '$2b$', '$2a$')
               ) AS password_matches
        FROM users
        WHERE lower(usn) = $2
           OR lower(registration_number) = $2
           OR lower(email) = $2
        LIMIT 2
        """,
        payload.password,
        identifier,
    )
    if len(users) != 1 or not users[0]["password_matches"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid identifier or password",
        )
    return TokenResponse(access_token=create_access_token(users[0]["id"], request))


@app.get("/api/admin/stats", response_model=AdminStats)
async def get_admin_stats(
    admin: dict[str, Any] = Depends(get_current_admin),
    db: asyncpg.Connection = Depends(get_db),
) -> AdminStats:
    counts = await db.fetchrow(
        """
        SELECT count(*) AS total_users,
               count(*) FILTER (WHERE role = 'student') AS total_students,
               (SELECT count(*) FROM subject_attendance) AS total_subject_records
        FROM users
        """
    )
    return AdminStats(**dict(counts))


@app.post("/api/sync", response_model=list[SubjectOutput])
async def sync_subjects(
    payload: SyncRequest,
    user_uuid: UUID = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    subjects = payload.subjects
    client_ids = [subject.client_subject_id for subject in subjects]
    if len(client_ids) != len(set(client_ids)):
        raise HTTPException(status_code=422, detail="Duplicate client_subject_id in request")

    try:
        async with db.transaction():
            for item in subjects:
                await db.execute(
                    """
                    INSERT INTO subject_attendance (
                        id, user_uuid, client_subject_id, subject_name,
                        classes_attended, total_classes, target_percentage
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (user_uuid, client_subject_id) DO UPDATE SET
                        subject_name = EXCLUDED.subject_name,
                        classes_attended = EXCLUDED.classes_attended,
                        total_classes = EXCLUDED.total_classes,
                        target_percentage = EXCLUDED.target_percentage
                    """,
                    uuid4(),
                    user_uuid,
                    item.client_subject_id,
                    item.subject_name,
                    item.classes_attended,
                    item.total_classes,
                    item.target_percentage,
                )

            if payload.replace_all:
                if client_ids:
                    await db.execute(
                        """
                        DELETE FROM subject_attendance
                        WHERE user_uuid = $1
                          AND NOT (client_subject_id = ANY($2::text[]))
                        """,
                        user_uuid,
                        client_ids,
                    )
                else:
                    await db.execute(
                        "DELETE FROM subject_attendance WHERE user_uuid = $1",
                        user_uuid,
                    )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(status_code=409, detail="Attendance record already exists") from exc

    rows = await db.fetch(
        """
        SELECT id, client_subject_id, subject_name, classes_attended,
               total_classes, target_percentage
        FROM subject_attendance
        WHERE user_uuid = $1
        ORDER BY subject_name, id
        """,
        user_uuid,
    )
    return [dict(row) for row in rows]


@app.get("/api/attendance", response_model=list[SubjectOutput])
async def get_attendance(
    user_uuid: UUID = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = await db.fetch(
        """
        SELECT id, client_subject_id, subject_name, classes_attended,
               total_classes, target_percentage
        FROM subject_attendance
        WHERE user_uuid = $1
        ORDER BY subject_name, id
        """,
        user_uuid,
    )
    return [dict(row) for row in rows]


async def _static_asset(request: Request, path: str) -> Response:
    if path == "api" or path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")

    environment = _worker_environment(request)
    if environment is None:
        raise HTTPException(status_code=404, detail="Page not found")
    try:
        assets = getattr(environment, "ASSETS")
    except (AttributeError, TypeError):
        try:
            assets = environment["ASSETS"]
        except (KeyError, TypeError):
            raise HTTPException(status_code=404, detail="Page not found")

    asset_response = await assets.fetch(f"https://assets.local/{path}")
    return Response(
        content=await asset_response.bytes(),
        status_code=asset_response.status,
        headers=asset_response.headers,
    )


@app.get("/", include_in_schema=False)
async def serve_homepage(request: Request) -> Response:
    return await _static_asset(request, "")


@app.get("/{path:path}", include_in_schema=False)
async def serve_frontend_asset(path: str, request: Request) -> Response:
    return await _static_asset(request, path)

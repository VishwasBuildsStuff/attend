"""BunkBudget authentication, attendance, and single-owner admin API."""

import os
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models import Base, SubjectAttendance, User
from schemas import AdminStats, LoginRequest, SyncRequest, SubjectOutput, TokenResponse, UserCreate


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip().lower()
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

if not DATABASE_URL:
    raise RuntimeError("Set DATABASE_URL to a PostgreSQL async SQLAlchemy URL.")
if not SECRET_KEY:
    raise RuntimeError("Set SECRET_KEY to a long random JWT signing key.")

database_url = make_url(DATABASE_URL)
if database_url.drivername == "postgresql":
    # Neon supplies standard PostgreSQL URLs; this app uses SQLAlchemy asyncpg.
    database_url = database_url.set(drivername="postgresql+asyncpg")

# asyncpg accepts `ssl`, while Neon connection strings use libpq's `sslmode`.
# `channel_binding` is a libpq option and is not an asyncpg connection argument.
database_query = dict(database_url.query)
sslmode = database_query.pop("sslmode", None)
database_query.pop("channel_binding", None)
database_url = database_url.set(query=database_query)
connect_args = {"ssl": sslmode} if sslmode else {}

engine = create_async_engine(
    database_url,
    pool_pre_ping=True,
    connect_args=connect_args,
)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)
security = HTTPBearer(auto_error=False)
password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="BunkBudget API", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        yield session


def create_access_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=60)},
        SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def decode_user_id(credentials: HTTPAuthorizationCredentials | None) -> UUID:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            options={"require_sub": True, "require_exp": True},
        )
        return UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.on_event("startup")
async def create_tables() -> None:
    # create_all handles new installs; these additive statements upgrade the
    # earlier BunkBudget users table without overwriting existing records.
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254)"))
        await connection.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS student_class VARCHAR(80)")
        )
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_number VARCHAR(40)"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20)"))
        await connection.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student'")
        )
        await connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci "
                "ON users (lower(email)) WHERE email IS NOT NULL"
            )
        )
        await connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_usn_ci "
                "ON users (lower(usn)) WHERE usn IS NOT NULL"
            )
        )
        await connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_registration_ci "
                "ON users (lower(registration_number)) WHERE registration_number IS NOT NULL"
            )
        )
        if ADMIN_EMAIL:
            await connection.execute(
                text(
                    "UPDATE users SET role = 'student' WHERE role = 'admin' "
                    "AND (email IS NULL OR lower(email) <> :admin_email)"
                ),
                {"admin_email": ADMIN_EMAIL},
            )
        else:
            await connection.execute(text("UPDATE users SET role = 'student' WHERE role = 'admin'"))


@app.on_event("shutdown")
async def close_engine() -> None:
    await engine.dispose()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> UUID:
    return decode_user_id(credentials)


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = decode_user_id(credentials)
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if (
        user is None
        or not ADMIN_EMAIL
        or user.role != "admin"
        or not user.email
        or user.email.strip().lower() != ADMIN_EMAIL
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


@app.post("/api/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    usn = payload.usn.strip().upper()
    registration_number = payload.registration_number.strip().upper()
    duplicate = await db.execute(
        select(User.id)
        .where(
            or_(
                func.lower(User.usn) == usn.lower(),
                func.lower(User.registration_number) == registration_number.lower(),
                func.lower(User.email) == payload.email,
            )
        )
        .limit(1)
    )
    if duplicate.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this USN, registration number, or email",
        )

    user = User(
        full_name=payload.full_name,
        student_class=payload.student_class,
        email=payload.email,
        usn=usn,
        registration_number=registration_number,
        phone_number=payload.phone_number,
        role="student",  # Never accept a role from the registration request.
        hashed_password=password_context.hash(payload.password),
    )
    db.add(user)
    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this USN, registration number, or email",
        )
    return TokenResponse(access_token=create_access_token(user.id))


@app.post("/api/login", response_model=TokenResponse)
async def login_user(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    identifier = payload.identifier.strip().lower()
    result = await db.execute(
        select(User)
        .where(
            or_(
                func.lower(User.usn) == identifier,
                func.lower(User.registration_number) == identifier,
                func.lower(User.email) == identifier,
            )
        )
        .limit(2)
    )
    users = result.scalars().all()
    if len(users) != 1:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid identifier or password")

    user = users[0]
    try:
        password_matches = password_context.verify(payload.password, user.hashed_password)
    except (TypeError, ValueError):
        password_matches = False
    if not password_matches:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid identifier or password")
    return TokenResponse(access_token=create_access_token(user.id))


@app.get("/api/admin/stats", response_model=AdminStats)
async def get_admin_stats(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStats:
    total_users = await db.scalar(select(func.count()).select_from(User)) or 0
    total_students = await db.scalar(
        select(func.count()).select_from(User).where(User.role == "student")
    ) or 0
    total_subject_records = await db.scalar(
        select(func.count()).select_from(SubjectAttendance)
    ) or 0
    return AdminStats(
        total_users=total_users,
        total_students=total_students,
        total_subject_records=total_subject_records,
    )


@app.post("/api/sync", response_model=list[SubjectOutput])
async def sync_subjects(
    payload: SyncRequest,
    user_uuid: UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SubjectAttendance]:
    subjects = payload.subjects
    client_ids = [subject.client_subject_id for subject in subjects]
    if len(client_ids) != len(set(client_ids)):
        raise HTTPException(status_code=422, detail="Duplicate client_subject_id in request")

    try:
        for item in subjects:
            result = await db.execute(
                select(SubjectAttendance).where(
                    SubjectAttendance.user_uuid == user_uuid,
                    SubjectAttendance.client_subject_id == item.client_subject_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                db.add(SubjectAttendance(
                    user_uuid=user_uuid,
                    client_subject_id=item.client_subject_id,
                    subject_name=item.subject_name,
                    classes_attended=item.classes_attended,
                    total_classes=item.total_classes,
                    target_percentage=item.target_percentage,
                ))
            else:
                row.subject_name = item.subject_name
                row.classes_attended = item.classes_attended
                row.total_classes = item.total_classes
                row.target_percentage = item.target_percentage

        if payload.replace_all:
            retained_ids = [item.client_subject_id for item in subjects]
            delete_query = select(SubjectAttendance).where(
                SubjectAttendance.user_uuid == user_uuid
            )
            if retained_ids:
                delete_query = delete_query.where(
                    SubjectAttendance.client_subject_id.not_in(retained_ids)
                )
            stale_rows = await db.execute(delete_query)
            for stale_row in stale_rows.scalars():
                await db.delete(stale_row)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    result = await db.execute(
        select(SubjectAttendance)
        .where(SubjectAttendance.user_uuid == user_uuid)
        .order_by(SubjectAttendance.subject_name, SubjectAttendance.id)
    )
    return list(result.scalars().all())


@app.get("/api/attendance", response_model=list[SubjectOutput])
async def get_attendance(
    user_uuid: UUID = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SubjectAttendance]:
    result = await db.execute(
        select(SubjectAttendance)
        .where(SubjectAttendance.user_uuid == user_uuid)
        .order_by(SubjectAttendance.subject_name, SubjectAttendance.id)
    )
    return list(result.scalars().all())

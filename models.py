"""SQLAlchemy models for BunkBudget."""

from uuid import UUID, uuid4

from sqlalchemy import Float, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    student_class: Mapped[str | None] = mapped_column(String(80), nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True)
    usn: Mapped[str | None] = mapped_column(String(10), unique=True, nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student", server_default="student")
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)


class SubjectAttendance(Base):
    __tablename__ = "subject_attendance"
    __table_args__ = (
        UniqueConstraint(
            "user_uuid", "client_subject_id", name="uq_attendance_user_client_subject"
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_uuid: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), index=True, nullable=False)
    subject_name: Mapped[str] = mapped_column(String(60), nullable=False)
    classes_attended: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_classes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    target_percentage: Mapped[float] = mapped_column(Float, nullable=False, default=75.0)
    client_subject_id: Mapped[str] = mapped_column(String(100), nullable=False)

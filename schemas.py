"""Pydantic v2 request/response schemas."""

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USN_PATTERN = re.compile(r"^[1-9][A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{3}$")
REGISTRATION_NUMBER_PATTERN = re.compile(r"^[A-Z0-9]{1,40}$")


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=120)
    student_class: str = Field(min_length=1, max_length=80)
    usn: str = Field(min_length=10, max_length=10)
    registration_number: str = Field(min_length=1, max_length=40)
    email: str = Field(min_length=5, max_length=254)
    phone_number: str = Field(min_length=10, max_length=20)
    password: str = Field(min_length=8, max_length=72)
    password_confirmation: str = Field(min_length=8, max_length=72)

    @field_validator("full_name", "student_class", "usn", "registration_number")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required")
        return value

    @field_validator("usn", "registration_number")
    @classmethod
    def normalize_identifiers(cls, value: str) -> str:
        return value.upper()

    @field_validator("email")
    @classmethod
    def normalize_and_validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("usn")
    @classmethod
    def validate_usn_format(cls, value: str) -> str:
        if not USN_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid USN (for example, 1AB23CD456)")
        return value

    @field_validator("registration_number")
    @classmethod
    def validate_registration_number_format(cls, value: str) -> str:
        if not REGISTRATION_NUMBER_PATTERN.fullmatch(value):
            raise ValueError("Registration number must contain only letters and numbers")
        return value

    @field_validator("phone_number")
    @classmethod
    def normalize_phone_number(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"\+?[0-9() .-]+", value):
            raise ValueError("Enter a valid phone number")
        has_plus = value.startswith("+")
        digits = re.sub(r"\D", "", value)
        if not 10 <= len(digits) <= 15:
            raise ValueError("Enter a phone number with 10 to 15 digits")
        return f"+{digits}" if has_plus else digits

    @model_validator(mode="after")
    def validate_password_confirmation(self):
        if self.password != self.password_confirmation:
            raise ValueError("Passwords do not match")
        if len(self.password.encode("utf-8")) > 72:
            raise ValueError("Password must be no more than 72 UTF-8 bytes")
        return self


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("identifier")
    @classmethod
    def strip_identifier(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Student ID, USN, or email is required")
        return value


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class SubjectInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    client_subject_id: str = Field(min_length=1, max_length=100)
    subject_name: str = Field(min_length=1, max_length=60)
    classes_attended: int = Field(ge=0)
    total_classes: int = Field(ge=0)
    target_percentage: float = Field(gt=0, le=100)

    @model_validator(mode="after")
    def attendance_counts_are_valid(self):
        if self.classes_attended > self.total_classes:
            raise ValueError("classes_attended cannot exceed total_classes")
        return self


class SyncRequest(BaseModel):
    subjects: list[SubjectInput]
    replace_all: bool = False


class SubjectOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    client_subject_id: str
    subject_name: str
    classes_attended: int
    total_classes: int
    target_percentage: float


class AdminStats(BaseModel):
    total_users: int
    total_students: int
    total_subject_records: int

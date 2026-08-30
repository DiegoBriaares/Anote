from __future__ import annotations


class ControlCenterError(RuntimeError):
    """A safe, actionable refusal at a Control Center ownership boundary."""

    def __init__(self, message: str, *, code: str = "control_center_error") -> None:
        super().__init__(message)
        self.code = code


class ContractError(ControlCenterError):
    """Persisted or transported input violates a strict Control Center contract."""


class RuntimeCommandError(ControlCenterError):
    """Docker Desktop or an Anote runtime command failed."""


class RuntimeStillActiveError(RuntimeCommandError):
    """Runtime stop could not be proved; data rollback is therefore forbidden."""

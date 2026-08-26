"""The SQLAdmin dashboard.

``settings.enable_admin`` defaults to ``False`` and the test environment (conftest)
never sets ``ENABLE_ADMIN``, so ``app.main.app`` — built once at import time — never
mounts the dashboard for this suite. That absence is itself the behaviour under test:
these confirm the default deployment exposes no admin surface at all.

The "does it leak the hash" half is covered directly against the ``ModelView``
declarations rather than by standing up an enabled admin instance, since the app the
``client`` fixture serves is fixed at import time and there is no way to have both an
admin-enabled and admin-disabled app in the same process without a subprocess.
"""

from fastapi.testclient import TestClient

from app.main import AIProviderConfigAdmin, CommentaryAdmin, UserAdmin
from app.models import AIProviderConfig, Commentary, User


def test_admin_is_not_mounted_by_default(client: TestClient) -> None:
    response = client.get("/admin", follow_redirects=False)
    assert response.status_code == 404


def test_admin_login_is_not_reachable_by_default(client: TestClient) -> None:
    response = client.get("/admin/login")
    assert response.status_code == 404


def test_user_admin_hides_the_password_hash_and_api_key_from_forms_and_details() -> None:
    excluded = {User.hashed_password, User.claude_api}
    assert excluded.issubset(set(UserAdmin.form_excluded_columns))
    assert excluded.issubset(set(UserAdmin.column_details_exclude_list))


def test_provider_admin_hides_the_encrypted_key_from_forms_and_details() -> None:
    assert AIProviderConfig.encrypted_api_key in AIProviderConfigAdmin.form_excluded_columns
    assert AIProviderConfig.encrypted_api_key in AIProviderConfigAdmin.column_details_exclude_list
    assert AIProviderConfig.encrypted_api_key not in AIProviderConfigAdmin.column_list


def test_user_admin_cannot_edit_or_delete() -> None:
    """Panel access must not be usable for account takeover via field rewrite —
    excluding a column from the details view is not enough on its own."""
    assert UserAdmin.can_edit is False
    assert UserAdmin.can_delete is False


def test_provider_admin_cannot_edit_or_delete() -> None:
    assert AIProviderConfigAdmin.can_edit is False
    assert AIProviderConfigAdmin.can_delete is False


def test_commentary_admin_cannot_edit_or_delete() -> None:
    assert CommentaryAdmin.can_edit is False
    assert CommentaryAdmin.can_delete is False
    assert Commentary.annotated_sgf_content not in CommentaryAdmin.column_list

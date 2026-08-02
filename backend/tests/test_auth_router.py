from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.crypto import decrypt_secret, encrypt_secret
from app.models import DEFAULT_USER_PREFERENCES, Commentary, CommentaryJob, User
from app.security import (
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)

# ── Registration ──────────────────────────────────────────────────────────────


def test_register_creates_a_user(client: TestClient, session: Session) -> None:
    response = client.post(
        "/auth/register/",
        json={"email": "new@example.com", "password": "a-good-password"},
    )

    assert response.status_code == 201
    assert response.json() == {"detail": "Account created."}
    created = session.exec(select(User).where(User.email == "new@example.com")).one()
    assert created.preferences == DEFAULT_USER_PREFERENCES
    assert created.claude_api is None


def test_register_stores_only_a_password_hash(client: TestClient, session: Session) -> None:
    client.post(
        "/auth/register/",
        json={"email": "new@example.com", "password": "a-good-password"},
    )

    created = session.exec(select(User).where(User.email == "new@example.com")).one()
    assert created.hashed_password != "a-good-password"
    assert verify_password("a-good-password", created.hashed_password)


def test_register_lowercases_the_email(client: TestClient, session: Session) -> None:
    """Otherwise ``Alice@…`` and ``alice@…`` would be two accounts."""
    client.post(
        "/auth/register/",
        json={"email": "MixedCase@Example.COM", "password": "a-good-password"},
    )
    assert session.exec(select(User).where(User.email == "mixedcase@example.com")).one()


def test_register_rejects_a_duplicate_email(client: TestClient, user: User) -> None:
    response = client.post(
        "/auth/register/", json={"email": user.email, "password": "a-good-password"}
    )
    assert response.status_code == 400
    assert response.json() == {"email": ["A user with this email already exists."]}


def test_register_rejects_a_duplicate_email_in_another_case(client: TestClient, user: User) -> None:
    response = client.post(
        "/auth/register/", json={"email": user.email.upper(), "password": "a-good-password"}
    )
    assert response.status_code == 400


def test_register_rejects_a_short_password(client: TestClient) -> None:
    response = client.post("/auth/register/", json={"email": "a@b.com", "password": "short"})
    assert response.status_code == 400
    assert "password" in response.json()


def test_register_rejects_a_malformed_email(client: TestClient) -> None:
    response = client.post("/auth/register/", json={"email": "not-an-email", "password": "x" * 10})
    assert response.status_code == 400
    assert "email" in response.json()


def test_register_rejects_a_password_too_long_for_bcrypt(client: TestClient) -> None:
    """bcrypt raises on any input over 72 bytes; this must surface as an ordinary
    field error rather than an unhandled 500."""
    response = client.post("/auth/register/", json={"email": "a@b.com", "password": "a" * 100})
    assert response.status_code == 400
    assert "password" in response.json()


# ── Token obtain / refresh ────────────────────────────────────────────────────


def test_token_obtain_returns_a_pair_and_the_user(
    client: TestClient, user: User, test_password: str
) -> None:
    response = client.post("/auth/token/", json={"email": user.email, "password": test_password})

    assert response.status_code == 200
    body = response.json()
    assert body["access"] and body["refresh"]
    assert body["user"] == {
        "id": user.id,
        "email": user.email,
        "preferences": user.preferences,
        "has_claude_api_key": False,
    }


def test_token_obtain_reports_a_stored_api_key(
    client: TestClient, make_user, test_password: str
) -> None:
    keyed = make_user("keyed@example.com", claude_api=encrypt_secret("sk-ant-test"))
    response = client.post("/auth/token/", json={"email": keyed.email, "password": test_password})
    assert response.json()["user"]["has_claude_api_key"] is True


def test_token_obtain_accepts_a_differently_cased_email(
    client: TestClient, user: User, test_password: str
) -> None:
    response = client.post(
        "/auth/token/", json={"email": user.email.upper(), "password": test_password}
    )
    assert response.status_code == 200


def test_token_obtain_rejects_a_wrong_password(client: TestClient, user: User) -> None:
    response = client.post("/auth/token/", json={"email": user.email, "password": "nope"})
    assert response.status_code == 401


def test_token_obtain_rejects_a_password_too_long_for_bcrypt(
    client: TestClient, user: User
) -> None:
    """An unauthenticated caller could otherwise trigger an unhandled 500 on every
    login attempt just by sending an over-length password."""
    response = client.post("/auth/token/", json={"email": user.email, "password": "a" * 100})
    assert response.status_code == 400
    assert "password" in response.json()


def test_token_obtain_rejects_an_unknown_email(client: TestClient, test_password: str) -> None:
    """Same status and message as a wrong password, so the response does not
    disclose which emails have accounts."""
    response = client.post(
        "/auth/token/", json={"email": "nobody@example.com", "password": test_password}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "No active account found with the given credentials."


def test_token_refresh_issues_a_new_pair(client: TestClient, user: User) -> None:
    refresh = create_refresh_token(user.id, user.email)
    response = client.post("/auth/token/refresh/", json={"refresh": refresh})

    assert response.status_code == 200
    body = response.json()
    assert body["access"] and body["refresh"]


def test_token_refresh_rejects_an_access_token(client: TestClient, auth_headers: dict) -> None:
    access = auth_headers["Authorization"].removeprefix("Bearer ")
    response = client.post("/auth/token/refresh/", json={"refresh": access})
    assert response.status_code == 401


def test_token_refresh_rejects_a_garbage_token(client: TestClient) -> None:
    assert client.post("/auth/token/refresh/", json={"refresh": "nope"}).status_code == 401


def test_token_refresh_rejects_a_token_for_a_deleted_user(
    client: TestClient, session: Session, user: User
) -> None:
    refresh = create_refresh_token(user.id, user.email)
    session.delete(user)
    session.commit()

    assert client.post("/auth/token/refresh/", json={"refresh": refresh}).status_code == 401


def test_token_refresh_rejects_a_token_predating_a_version_bump(
    client: TestClient, session: Session, user: User
) -> None:
    refresh = create_refresh_token(user.id, user.email, 0)
    user.token_version = 1
    session.add(user)
    session.commit()

    response = client.post("/auth/token/refresh/", json={"refresh": refresh})
    assert response.status_code == 401


def test_token_refresh_reissues_the_current_version(client: TestClient, user: User) -> None:
    refresh = create_refresh_token(user.id, user.email, user.token_version)
    body = client.post("/auth/token/refresh/", json={"refresh": refresh}).json()

    assert decode_token(body["access"], ACCESS_TOKEN_TYPE)["token_version"] == user.token_version
    assert decode_token(body["refresh"], REFRESH_TOKEN_TYPE)["token_version"] == user.token_version


# ── Logout ─────────────────────────────────────────────────────────────────────


def test_logout_invalidates_the_access_token_that_called_it(
    client: TestClient, auth_headers: dict
) -> None:
    response = client.post("/auth/logout/", headers=auth_headers)
    assert response.status_code == 200

    assert client.get("/auth/user/settings/", headers=auth_headers).status_code == 401


def test_logout_invalidates_outstanding_refresh_tokens(
    client: TestClient, auth_headers: dict, user: User
) -> None:
    refresh = create_refresh_token(user.id, user.email, user.token_version)

    client.post("/auth/logout/", headers=auth_headers)

    response = client.post("/auth/token/refresh/", json={"refresh": refresh})
    assert response.status_code == 401


def test_logout_requires_authentication(client: TestClient) -> None:
    assert client.post("/auth/logout/").status_code == 401


def test_a_fresh_login_after_logout_works(
    client: TestClient, auth_headers: dict, user: User, test_password: str
) -> None:
    client.post("/auth/logout/", headers=auth_headers)

    response = client.post("/auth/token/", json={"email": user.email, "password": test_password})
    assert response.status_code == 200
    new_access = response.json()["access"]
    assert (
        client.get(
            "/auth/user/settings/", headers={"Authorization": f"Bearer {new_access}"}
        ).status_code
        == 200
    )


def test_refreshed_tokens_are_usable(client: TestClient, user: User) -> None:
    refresh = create_refresh_token(user.id, user.email)
    body = client.post("/auth/token/refresh/", json={"refresh": refresh}).json()

    settings_response = client.get(
        "/auth/user/settings/", headers={"Authorization": f"Bearer {body['access']}"}
    )
    assert settings_response.status_code == 200
    assert decode_token(body["refresh"], REFRESH_TOKEN_TYPE)["sub"] == str(user.id)


# ── User settings ─────────────────────────────────────────────────────────────


def test_get_settings_returns_the_stored_preferences(
    client: TestClient, auth_headers: dict
) -> None:
    response = client.get("/auth/user/settings/", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "preferences": DEFAULT_USER_PREFERENCES,
        "has_claude_api_key": False,
    }


def test_update_settings_merges_rather_than_replaces(
    client: TestClient, auth_headers: dict
) -> None:
    """Saving one tab must not wipe another tab's saved section."""
    response = client.put(
        "/auth/user/settings/",
        headers=auth_headers,
        json={"preferences": {"theme": "dark"}},
    )

    assert response.status_code == 200
    preferences = response.json()["preferences"]
    assert preferences["theme"] == "dark"
    assert preferences["commentary_config"] == DEFAULT_USER_PREFERENCES["commentary_config"]


def test_update_settings_persists(client: TestClient, auth_headers: dict) -> None:
    client.put(
        "/auth/user/settings/",
        headers=auth_headers,
        json={"preferences": {"theme": "dark"}},
    )
    reread = client.get("/auth/user/settings/", headers=auth_headers).json()
    assert reread["preferences"]["theme"] == "dark"


def test_update_settings_requires_authentication(client: TestClient) -> None:
    assert client.put("/auth/user/settings/", json={"preferences": {}}).status_code == 401


# ── Claude API key ────────────────────────────────────────────────────────────


def test_setting_the_api_key_stores_only_ciphertext(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    response = client.put(
        "/auth/user/claude-api-key/",
        headers=auth_headers,
        json={"claude_api_key": "sk-ant-api03-not-a-real-key"},
    )

    assert response.status_code == 200
    assert response.json()["has_claude_api_key"] is True
    stored = session.get(User, user.id)
    session.refresh(stored)
    assert stored.claude_api != "sk-ant-api03-not-a-real-key"
    assert decrypt_secret(stored.claude_api) == "sk-ant-api03-not-a-real-key"


def test_setting_the_api_key_strips_surrounding_whitespace(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    """A key pasted from a terminal often carries a trailing newline."""
    client.put(
        "/auth/user/claude-api-key/",
        headers=auth_headers,
        json={"claude_api_key": "  sk-ant-padded  \n"},
    )
    stored = session.get(User, user.id)
    session.refresh(stored)
    assert decrypt_secret(stored.claude_api) == "sk-ant-padded"


def test_the_api_key_is_never_echoed_back(client: TestClient, auth_headers: dict) -> None:
    response = client.put(
        "/auth/user/claude-api-key/",
        headers=auth_headers,
        json={"claude_api_key": "sk-ant-api03-not-a-real-key"},
    )
    assert "sk-ant-api03-not-a-real-key" not in response.text


def test_setting_an_empty_api_key_is_rejected(client: TestClient, auth_headers: dict) -> None:
    response = client.put(
        "/auth/user/claude-api-key/", headers=auth_headers, json={"claude_api_key": ""}
    )
    assert response.status_code == 400


def test_deleting_the_api_key_clears_it(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    client.put(
        "/auth/user/claude-api-key/",
        headers=auth_headers,
        json={"claude_api_key": "sk-ant-test"},
    )

    response = client.delete("/auth/user/claude-api-key/", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["has_claude_api_key"] is False
    stored = session.get(User, user.id)
    session.refresh(stored)
    assert stored.claude_api is None


def test_deleting_an_absent_api_key_is_a_no_op(client: TestClient, auth_headers: dict) -> None:
    response = client.delete("/auth/user/claude-api-key/", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["has_claude_api_key"] is False


# ── Account management ────────────────────────────────────────────────────────


def test_update_email_changes_the_address(
    client: TestClient, session: Session, auth_headers: dict, user: User, test_password: str
) -> None:
    response = client.post(
        "/auth/user/update-email/",
        headers=auth_headers,
        json={"email": "Changed@Example.com", "password": test_password},
    )

    assert response.status_code == 200
    session.refresh(user)
    assert user.email == "changed@example.com"


def test_update_email_requires_the_current_password(client: TestClient, auth_headers: dict) -> None:
    response = client.post(
        "/auth/user/update-email/",
        headers=auth_headers,
        json={"email": "changed@example.com", "password": "wrong"},
    )
    assert response.status_code == 400
    assert response.json() == {"password": ["Incorrect password."]}


def test_update_email_rejects_an_address_another_user_holds(
    client: TestClient, auth_headers: dict, make_user, test_password: str
) -> None:
    make_user("taken@example.com")
    response = client.post(
        "/auth/user/update-email/",
        headers=auth_headers,
        json={"email": "taken@example.com", "password": test_password},
    )
    assert response.status_code == 400
    assert response.json() == {"email": ["This email is already in use."]}


def test_update_email_allows_re_saving_your_own_address(
    client: TestClient, auth_headers: dict, user: User, test_password: str
) -> None:
    """The conflict query excludes the caller, so this must not self-collide."""
    response = client.post(
        "/auth/user/update-email/",
        headers=auth_headers,
        json={"email": user.email, "password": test_password},
    )
    assert response.status_code == 200


def test_update_password_replaces_the_hash(
    client: TestClient, session: Session, auth_headers: dict, user: User, test_password: str
) -> None:
    response = client.post(
        "/auth/user/update-password/",
        headers=auth_headers,
        json={"current_password": test_password, "new_password": "a-brand-new-password"},
    )

    assert response.status_code == 200
    session.refresh(user)
    assert verify_password("a-brand-new-password", user.hashed_password)
    assert not verify_password(test_password, user.hashed_password)


def test_update_password_invalidates_the_token_that_made_the_change(
    client: TestClient, auth_headers: dict, test_password: str
) -> None:
    """A stolen token must not keep working for the rest of its lifetime after the
    victim responds to noticing the theft by changing their password."""
    client.post(
        "/auth/user/update-password/",
        headers=auth_headers,
        json={"current_password": test_password, "new_password": "a-brand-new-password"},
    )

    assert client.get("/auth/user/settings/", headers=auth_headers).status_code == 401


def test_update_password_requires_the_current_password(
    client: TestClient, auth_headers: dict
) -> None:
    response = client.post(
        "/auth/user/update-password/",
        headers=auth_headers,
        json={"current_password": "wrong", "new_password": "a-brand-new-password"},
    )
    assert response.status_code == 400
    assert response.json() == {"current_password": ["Incorrect password."]}


def test_update_password_rejects_a_short_new_password(
    client: TestClient, auth_headers: dict, test_password: str
) -> None:
    response = client.post(
        "/auth/user/update-password/",
        headers=auth_headers,
        json={"current_password": test_password, "new_password": "short"},
    )
    assert response.status_code == 400
    assert "new_password" in response.json()


def test_update_password_rejects_a_new_password_too_long_for_bcrypt(
    client: TestClient, auth_headers: dict, test_password: str
) -> None:
    response = client.post(
        "/auth/user/update-password/",
        headers=auth_headers,
        json={"current_password": test_password, "new_password": "a" * 100},
    )
    assert response.status_code == 400
    assert "new_password" in response.json()


def test_update_password_rejects_a_current_password_too_long_for_bcrypt(
    client: TestClient, auth_headers: dict
) -> None:
    response = client.post(
        "/auth/user/update-password/",
        headers=auth_headers,
        json={"current_password": "a" * 100, "new_password": "a-brand-new-password"},
    )
    assert response.status_code == 400
    assert "current_password" in response.json()


def test_delete_account_removes_the_user(
    client: TestClient, session: Session, auth_headers: dict, user: User, test_password: str
) -> None:
    user_id = user.id
    response = client.request(
        "DELETE",
        "/auth/user/delete/",
        headers=auth_headers,
        json={"password": test_password},
    )

    assert response.status_code == 204
    # The row was removed through the request's own session; detach ours so the
    # lookup below hits the database rather than the identity map.
    session.expunge_all()
    assert session.get(User, user_id) is None


def test_delete_account_requires_the_password(client: TestClient, auth_headers: dict) -> None:
    response = client.request(
        "DELETE", "/auth/user/delete/", headers=auth_headers, json={"password": "wrong"}
    )
    assert response.status_code == 400


def test_delete_account_removes_the_users_commentaries_and_jobs(
    client: TestClient, session: Session, auth_headers: dict, user: User, test_password: str
) -> None:
    """A deleted user's rows must not survive to be handed to whoever gets their
    reused id next — see test_history_does_not_leak_a_deleted_users_rows below."""
    user_id = user.id
    session.add(Commentary(user_id=user_id, sgf_file_name="mine.sgf", moves=[], comments=[]))
    session.add(CommentaryJob(user_id=user_id, status="succeeded"))
    session.commit()

    response = client.request(
        "DELETE",
        "/auth/user/delete/",
        headers=auth_headers,
        json={"password": test_password},
    )

    assert response.status_code == 204
    session.expunge_all()
    assert session.exec(select(Commentary).where(Commentary.user_id == user_id)).all() == []
    assert session.exec(select(CommentaryJob).where(CommentaryJob.user_id == user_id)).all() == []


def test_history_does_not_leak_a_deleted_users_rows(
    client: TestClient, session: Session, user: User, test_password: str, make_user
) -> None:
    """Regression test for a deleted account's history leaking to whichever future
    account is assigned the same (SQLite-reused) id."""
    deleted_user_id = user.id
    session.add(
        Commentary(user_id=deleted_user_id, sgf_file_name="alices-game.sgf", moves=[], comments=[])
    )
    session.commit()

    delete_response = client.request(
        "DELETE",
        "/auth/user/delete/",
        headers={"Authorization": f"Bearer {create_access_token(user.id, user.email)}"},
        json={"password": test_password},
    )
    assert delete_response.status_code == 204

    session.expunge_all()
    successor = make_user("bob@example.com")
    assert successor.id == deleted_user_id  # SQLite reuses the freed rowid.

    successor_headers = {
        "Authorization": f"Bearer {create_access_token(successor.id, successor.email)}"
    }
    history = client.get("/auth/user/commentary-history/", headers=successor_headers).json()
    assert history["commentaries"] == []


# ── Commentary history ────────────────────────────────────────────────────────


def test_history_is_empty_for_a_new_account(client: TestClient, auth_headers: dict) -> None:
    response = client.get("/auth/user/commentary-history/", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"commentaries": [], "total": 0}


def test_history_returns_the_users_own_commentaries(
    client: TestClient, session: Session, auth_headers: dict, user: User, make_user
) -> None:
    other = make_user("other@example.com")
    session.add(
        Commentary(
            user_id=user.id,
            board_size=19,
            sgf_file_name="mine.sgf",
            language="english",
            model="claude-sonnet-5",
            usage={
                "input_tokens": 10,
                "output_tokens": 5,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
            moves=[["B", [3, 3]]],
            initial_stones=[],
            comments=[{"turn": 1, "comment": "Hi", "winrate_delta": -12.5, "color": "B"}],
            annotated_sgf_content="(;FF[4])",
        )
    )
    session.add(Commentary(user_id=other.id, sgf_file_name="theirs.sgf", moves=[], comments=[]))
    session.commit()

    body = client.get("/auth/user/commentary-history/", headers=auth_headers).json()

    assert [item["sgf_file_name"] for item in body["commentaries"]] == ["mine.sgf"]
    assert body["total"] == 1
    assert body["commentaries"][0]["comment_count"] == 1
    # The list is a summary — full comment text and the annotated SGF are not in it.
    assert "comments" not in body["commentaries"][0]
    assert "annotated_sgf_content" not in body["commentaries"][0]


def test_history_list_replays_rows_saved_before_the_model_column_existed(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    session.add(
        Commentary(
            user_id=user.id,
            sgf_file_name="legacy.sgf",
            moves=[["B", [3, 3]]],
            comments=[{"turn": 1, "comment": "Old row"}],
        )
    )
    session.commit()

    response = client.get("/auth/user/commentary-history/", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["commentaries"][0]["model"] is None


def test_history_is_paginated_newest_first(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    for i in range(3):
        session.add(
            Commentary(user_id=user.id, sgf_file_name=f"game{i}.sgf", moves=[], comments=[])
        )
    session.commit()

    first_page = client.get(
        "/auth/user/commentary-history/", headers=auth_headers, params={"limit": 2}
    ).json()
    assert [c["sgf_file_name"] for c in first_page["commentaries"]] == ["game2.sgf", "game1.sgf"]
    assert first_page["total"] == 3

    second_page = client.get(
        "/auth/user/commentary-history/",
        headers=auth_headers,
        params={"limit": 2, "offset": 2},
    ).json()
    assert [c["sgf_file_name"] for c in second_page["commentaries"]] == ["game0.sgf"]
    assert second_page["total"] == 3


def test_history_page_size_is_capped(client: TestClient, auth_headers: dict) -> None:
    response = client.get(
        "/auth/user/commentary-history/", headers=auth_headers, params={"limit": 500}
    )
    assert response.status_code == 400


def test_history_detail_returns_the_full_record(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    commentary = Commentary(
        user_id=user.id,
        board_size=19,
        sgf_file_name="mine.sgf",
        language="english",
        model="claude-sonnet-5",
        usage={
            "input_tokens": 10,
            "output_tokens": 5,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
        },
        moves=[["B", [3, 3]]],
        initial_stones=[],
        comments=[{"turn": 1, "comment": "Hi", "winrate_delta": -12.5, "color": "B"}],
        annotated_sgf_content="(;FF[4]C[Hi])",
    )
    session.add(commentary)
    session.commit()
    session.refresh(commentary)

    response = client.get(f"/auth/user/commentary-history/{commentary.id}/", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["comments"][0]["winrate_delta"] == -12.5
    assert body["annotated_sgf_content"] == "(;FF[4]C[Hi])"


def test_history_detail_replays_rows_saved_before_the_newer_columns_existed(
    client: TestClient, session: Session, auth_headers: dict, user: User
) -> None:
    """``model``/``usage``/``winrate_delta``/``color`` are optional precisely so
    that legacy rows do not 500 this endpoint."""
    commentary = Commentary(
        user_id=user.id,
        sgf_file_name="legacy.sgf",
        moves=[["B", [3, 3]]],
        comments=[{"turn": 1, "comment": "Old row"}],
    )
    session.add(commentary)
    session.commit()
    session.refresh(commentary)

    response = client.get(f"/auth/user/commentary-history/{commentary.id}/", headers=auth_headers)

    assert response.status_code == 200
    entry = response.json()
    assert entry["model"] is None
    assert entry["usage"] is None
    assert entry["comments"][0]["winrate_delta"] is None
    assert entry["comments"][0]["color"] is None


def test_history_detail_is_missing_for_an_unknown_id(
    client: TestClient, auth_headers: dict
) -> None:
    response = client.get("/auth/user/commentary-history/999999/", headers=auth_headers)
    assert response.status_code == 404


def test_history_detail_is_missing_for_another_users_commentary(
    client: TestClient, session: Session, auth_headers: dict, make_user
) -> None:
    other = make_user("other@example.com")
    commentary = Commentary(user_id=other.id, sgf_file_name="theirs.sgf", moves=[], comments=[])
    session.add(commentary)
    session.commit()
    session.refresh(commentary)

    response = client.get(f"/auth/user/commentary-history/{commentary.id}/", headers=auth_headers)
    assert response.status_code == 404


def test_history_detail_requires_authentication(client: TestClient) -> None:
    assert client.get("/auth/user/commentary-history/1/").status_code == 401


def test_history_requires_authentication(client: TestClient) -> None:
    assert client.get("/auth/user/commentary-history/").status_code == 401

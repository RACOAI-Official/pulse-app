"""Operator-only setup commands; use service credentials from the environment."""

import argparse
import os

from cryptography.fernet import Fernet

from .settings import get_settings
from .store import service_auth_request, service_request


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m pulse_api.operator")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("generate-key")
    tenant = sub.add_parser("create-tenant")
    tenant.add_argument("--name", required=True)
    tenant.add_argument("--owner-email", required=True)
    connection = sub.add_parser("connect-channel")
    connection.add_argument("--tenant-id", required=True)
    connection.add_argument("--channel", choices=["messenger", "instagram", "whatsapp"], required=True)
    connection.add_argument("--account-id", required=True)
    connection.add_argument("--display-name", required=True)
    args = parser.parse_args()

    if args.command == "generate-key":
        print(Fernet.generate_key().decode())
    elif args.command == "create-tenant":
        invited = service_auth_request("POST", "invite", body={"email": args.owner_email},
            params={"redirect_to": f"{get_settings().pulse_web_origin}/auth/callback"})
        if not invited.get("id"):
            raise RuntimeError("Auth invite did not return a user ID")
        rows = service_request("POST", "tenants", body={"name": args.name},
                               prefer="return=representation")
        created = rows[0]
        service_request("POST", "memberships", body={
            "tenant_id": created["id"], "user_id": invited["id"], "role": "owner",
        })
        print(f"Created tenant {created['id']} and invited owner {args.owner_email}")
    elif args.command == "connect-channel":
        token = os.environ.get("PULSE_CHANNEL_TOKEN")
        key = get_settings().pulse_credential_key
        if not token or not key:
            raise RuntimeError("PULSE_CHANNEL_TOKEN and PULSE_CREDENTIAL_KEY are required")
        encrypted = Fernet(key.encode()).encrypt(token.encode()).decode()
        rows = service_request("POST", "channel_connections", body={
            "tenant_id": args.tenant_id, "channel": args.channel,
            "external_account_id": args.account_id, "display_name": args.display_name,
            "credential_ciphertext": encrypted, "status": "connected",
        }, prefer="return=representation")
        print(f"Connected {args.channel} as {rows[0]['id']}")


if __name__ == "__main__":
    main()

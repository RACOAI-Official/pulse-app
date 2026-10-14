import os

from cryptography.fernet import Fernet

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("META_APP_SECRET", "test-secret")
os.environ.setdefault("META_VERIFY_TOKEN", "test-verify")
os.environ.setdefault("META_GRAPH_VERSION", "v25.0")
os.environ.setdefault("PULSE_CREDENTIAL_KEY", Fernet.generate_key().decode())

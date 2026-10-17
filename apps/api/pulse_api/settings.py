from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    redis_url: str = "redis://localhost:6379/0"
    pulse_web_origin: str = "http://localhost:3000"
    pulse_credential_key: str = ""
    meta_app_secret: str
    meta_verify_token: str
    meta_graph_version: str
    pulse_echo_mode: bool = False
    pulse_llm_chat_url: str = ""
    pulse_llm_model: str = ""
    pulse_llm_api_key: str = ""
    pulse_llm_disable_thinking: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

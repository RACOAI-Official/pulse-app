from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # apps/api/.env holds the SMTP settings; it is read after the working-directory .env.
    model_config = SettingsConfigDict(env_file=(".env", str(Path(__file__).resolve().parents[1] / ".env")),
                                      extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    redis_url: str = "redis://localhost:6379/0"
    pulse_web_origin: str = "http://localhost:3000"
    pulse_credential_key: str = ""
    meta_app_secret: str
    instagram_app_secret: str = ""
    meta_verify_token: str
    meta_graph_version: str
    # Self-serve channel connect (Facebook Login for Business, Instagram Login, WhatsApp Embedded Signup).
    meta_app_id: str = ""
    meta_login_config_id: str = ""
    meta_whatsapp_config_id: str = ""
    instagram_app_id: str = ""
    pulse_echo_mode: bool = False
    # Interactive API docs (/docs, /redoc, /openapi.json); set PULSE_API_DOCS=false in production.
    pulse_api_docs: bool = True
    pulse_llm_chat_url: str = ""
    pulse_llm_model: str = ""
    pulse_llm_api_key: str = ""
    pulse_llm_disable_thinking: bool = False
    mail_host: str = ""
    mail_port: int = 465
    mail_user: str = ""
    mail_pass: str = ""
    company_email_from: str = ""
    resend_api_key: str = ""
    vision_url: str = ""
    vision_model: str = "Qdrant/Unicom-ViT-B-32"
    vision_match_threshold: float = 0.70
    # Platform subscription billing (Pulse's own gateway accounts, not merchants').
    pulse_api_public_url: str = ""
    pulse_stripe_secret_key: str = ""
    pulse_stripe_webhook_secret: str = ""
    pulse_stripe_price_pro_month_usd: str = ""
    pulse_stripe_price_pro_year_usd: str = ""
    pulse_stripe_price_pro_month_gbp: str = ""
    pulse_stripe_price_pro_year_gbp: str = ""
    pulse_stripe_price_enterprise_month_usd: str = ""
    pulse_stripe_price_enterprise_year_usd: str = ""
    pulse_stripe_price_enterprise_month_gbp: str = ""
    pulse_stripe_price_enterprise_year_gbp: str = ""
    pulse_ssl_store_id: str = ""
    pulse_ssl_store_passwd: str = ""
    pulse_ssl_environment: str = "sandbox"
    # Fixed price table in minor units (cents, pence, paisa). Yearly = 10 x monthly.
    pulse_price_pro_month_usd: int = 3000
    pulse_price_pro_year_usd: int = 30000
    pulse_price_pro_month_gbp: int = 2500
    pulse_price_pro_year_gbp: int = 25000
    pulse_price_pro_month_bdt: int = 350000
    pulse_price_pro_year_bdt: int = 3500000
    pulse_price_enterprise_month_usd: int = 10000
    pulse_price_enterprise_year_usd: int = 100000
    pulse_price_enterprise_month_gbp: int = 8000
    pulse_price_enterprise_year_gbp: int = 80000
    pulse_price_enterprise_month_bdt: int = 1200000
    pulse_price_enterprise_year_bdt: int = 12000000
    # Monthly AI credit allowances; 1 credit = 1 AI auto-reply.
    pulse_credits_pro: int = 4000
    pulse_credits_enterprise: int = 15000
    pulse_terms_url: str = ""
    pulse_privacy_url: str = ""
    pulse_refund_url: str = ""
    # Owner alerts (email + WhatsApp). Off until the operator has configured senders.
    pulse_notifications_enabled: bool = False
    # Pulse's own WhatsApp Cloud API number (not a tenant channel).
    pulse_whatsapp_phone_id: str = ""
    pulse_whatsapp_number: str = ""
    pulse_whatsapp_token: str = ""
    pulse_whatsapp_app_secret: str = ""
    pulse_whatsapp_verify_token: str = ""
    # Meta-approved template name per alert (one name, languages bn + en). Empty = WhatsApp skipped.
    pulse_whatsapp_template_order_confirmed: str = ""
    pulse_whatsapp_template_order_drafted: str = ""
    pulse_whatsapp_template_credits_low: str = ""
    pulse_whatsapp_template_credits_empty: str = ""
    pulse_whatsapp_template_plan_ending: str = ""
    pulse_whatsapp_template_plan_expired: str = ""
    pulse_whatsapp_template_test: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()

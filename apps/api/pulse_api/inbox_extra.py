"""Ticket and public-comment operations for the tenant inbox."""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .deps import Session, membership, user_limit
from .main import dispatch
from .store import eq, user_request
from .tasks import send_public_comment_reply

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["inbox"])


class TicketInput(BaseModel):
    conversation_id: UUID
    subject: str = Field(min_length=1, max_length=160)


class TicketStatus(BaseModel):
    status: str = Field(pattern="^(active|resolved)$")


class CommentReply(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class CustomerUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=160)
    phone: str = Field(default="", max_length=40)


class CustomerLink(BaseModel):
    conversation_id: UUID


@router.get("/tickets")
async def tickets(tenant_id: UUID, auth: Session) -> list[dict]:
    await membership(tenant_id, auth[0])
    return await user_request("GET", "support_tickets", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "*", "order": "created_at.desc", "limit": "200",
    })


@router.get("/unreplied-conversations")
async def unreplied_conversations(tenant_id: UUID, auth: Session) -> list[dict]:
    await membership(tenant_id, auth[0])
    return await user_request("POST", "rpc/pulse_unreplied_conversations", auth[0], body={
        "p_tenant_id": str(tenant_id),
    })


@router.post("/tickets")
async def create_ticket(tenant_id: UUID, data: TicketInput, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    ticket_id = await user_request("POST", "rpc/pulse_create_ticket", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_conversation_id": str(data.conversation_id),
        "p_subject": data.subject,
    })
    return {"id": ticket_id}


@router.post("/tickets/{ticket_id}/status")
async def ticket_status(tenant_id: UUID, ticket_id: UUID, data: TicketStatus, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    status = await user_request("POST", "rpc/pulse_set_ticket_status", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_ticket_id": str(ticket_id), "p_status": data.status,
    })
    return {"status": status}


@router.get("/comments")
async def comments(tenant_id: UUID, auth: Session) -> list[dict]:
    await membership(tenant_id, auth[0])
    return await user_request("GET", "public_comments", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "*", "order": "created_at.desc", "limit": "200",
    })


@router.post("/comments/{comment_id}/reply", dependencies=[user_limit("comment-reply", 60, 60)])
async def reply_to_comment(tenant_id: UUID, comment_id: UUID, data: CommentReply, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "public_comments", auth[0], params={
        "id": eq(str(comment_id)), "tenant_id": eq(str(tenant_id)), "select": "id", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Comment not found")
    queued_id = await user_request("POST", "rpc/pulse_queue_comment_reply", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_comment_id": str(comment_id), "p_body": data.body,
    })
    dispatch(send_public_comment_reply, str(queued_id))
    return {"reply_status": "queued"}


@router.get("/customers")
async def customers(tenant_id: UUID, auth: Session) -> list[dict]:
    await membership(tenant_id, auth[0])
    profiles = await user_request("GET", "customer_profiles", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "*", "order": "updated_at.desc", "limit": "500",
    })
    conversations = await user_request("GET", "conversations", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "select": "id,customer_id,channel,customer_name,last_message_at",
        "order": "last_message_at.desc", "limit": "1000",
    })
    by_customer: dict[str, list[dict]] = {}
    for row in conversations:
        if row.get("customer_id"):
            by_customer.setdefault(row["customer_id"], []).append(row)
    return [{**profile, "conversations": by_customer.get(profile["id"], [])}
            for profile in profiles if by_customer.get(profile["id"])]


@router.get("/customers/{customer_id}/timeline")
async def customer_timeline(tenant_id: UUID, customer_id: UUID, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    rows = await user_request("GET", "customer_profiles", auth[0], params={
        "id": eq(str(customer_id)), "tenant_id": eq(str(tenant_id)), "select": "*", "limit": "1",
    })
    if not rows:
        raise HTTPException(404, "Customer not found")
    conversations = await user_request("GET", "conversations", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "customer_id": eq(str(customer_id)),
        "select": "id,channel,customer_name,last_message_at", "limit": "100",
    })
    ids = [row["id"] for row in conversations]
    messages = await user_request("GET", "messages", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "conversation_id": f"in.({','.join(ids)})",
        "select": "id,conversation_id,channel,direction,sender_type,body,created_at",
        "order": "created_at.desc", "limit": "200",
    }) if ids else []
    orders = await user_request("GET", "commerce_orders", auth[0], params={
        "tenant_id": eq(str(tenant_id)), "customer_id": eq(str(customer_id)),
        "select": "id,state,total_minor,currency_code,created_at",
        "order": "created_at.desc", "limit": "100",
    })
    return {"customer": rows[0], "conversations": conversations,
            "messages": messages, "orders": orders}


@router.put("/customers/{customer_id}")
async def update_customer(tenant_id: UUID, customer_id: UUID,
                          data: CustomerUpdate, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    result = await user_request("POST", "rpc/pulse_update_customer", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_customer_id": str(customer_id),
        "p_name": data.display_name, "p_phone": data.phone,
    })
    return {"id": result}


@router.post("/customers/{customer_id}/conversations")
async def link_customer(tenant_id: UUID, customer_id: UUID,
                        data: CustomerLink, auth: Session) -> dict:
    await membership(tenant_id, auth[0])
    result = await user_request("POST", "rpc/pulse_link_customer", auth[0], body={
        "p_tenant_id": str(tenant_id), "p_customer_id": str(customer_id),
        "p_conversation_id": str(data.conversation_id),
    })
    return {"customer_id": result}

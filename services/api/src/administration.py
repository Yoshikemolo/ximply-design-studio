"""The administration workspace of the studio (FEAT-0032, SC-0137, SC-0138, SC-0141 to SC-0146).

Users, roles, licences and documents are administered here without going to the Keycloak
console. Every endpoint requires the super administrator; every change is audited without
passwords or tokens.
"""

from datetime import datetime, timezone
from typing import Annotated, Callable, Literal

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .identity import (ADMIN_ROLE, BAN_REASON_ATTRIBUTE, BAN_UNTIL_ATTRIBUTE, ISSUED_ATTRIBUTE, LICENCE_ATTRIBUTE,
                       PERMISSIONS, ROLE_DESCRIPTIONS, ROLES, STATUS_ATTRIBUTE, TIER_ATTRIBUTE, TIERS, AuditLog,
                       IdentityError, KeycloakAdmin, extended_expiry, format_instant, licence_expiry, licence_state,
                       parse_instant, tier_of, valid_user_id)

Permission = Literal['ai-tools', 'change-control']
Tier = Literal['free', 'pro', 'teams', 'studio', 'enterprise']
Role = Literal['xds-admin', 'ai-tools', 'change-control']
Name = Annotated[str, Field(max_length=100)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
Day = Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}$')]
Days = Annotated[int, Field(ge=1, le=3650)]


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class NewUser(Strict):
    username: Annotated[str, Field(min_length=3, max_length=60, pattern=r'^[A-Za-z0-9._@-]+$')]
    email: Annotated[str, Field(max_length=200, pattern=r'^[^@\s]+@[^@\s]+\.[^@\s]+$')]
    firstName: Name
    lastName: Name
    password: Password
    temporary: bool = True
    admin: bool = False


class UserChange(Strict):
    email: Annotated[str, Field(max_length=200, pattern=r'^[^@\s]+@[^@\s]+\.[^@\s]+$')] | None = None
    firstName: Name | None = None
    lastName: Name | None = None


class PasswordChange(Strict):
    password: Password
    temporary: bool = True


class Ban(Strict):
    """A ban until an instant, or a permanent one when until is absent."""
    until: datetime | None = None
    reason: Annotated[str, Field(max_length=200)] = ''


class LicenceRequest(Strict):
    tier: Tier = 'pro'
    permissions: Annotated[list[Permission], Field(min_length=1, max_length=len(PERMISSIONS))]
    days: Days | None = None
    until: Day | None = None


class LicenceChange(Strict):
    tier: Tier | None = None
    permissions: Annotated[list[Permission], Field(min_length=1, max_length=len(PERMISSIONS))] | None = None
    days: Days | None = None
    until: Day | None = None
    status: Literal['active', 'suspended'] | None = None

    @model_validator(mode='after')
    def one_period(self):
        if self.days is not None and self.until is not None:
            raise ValueError('Give either a number of days or an expiry date')
        return self


class ExtendRequest(Strict):
    days: Days


def ban_of(user: dict, now: datetime) -> dict | None:
    until = user['attributes'].get(BAN_UNTIL_ATTRIBUTE)
    if until is None:
        return None
    instant = parse_instant(until)
    return {'permanent': until == 'permanent', 'until': format_instant(instant) if instant else None,
            'reason': user['attributes'].get(BAN_REASON_ATTRIBUTE, ''), 'expired': bool(instant and instant <= now)}


def licence_of(user: dict, now: datetime) -> dict:
    attributes = user['attributes']
    expires = parse_instant(attributes.get(LICENCE_ATTRIBUTE))
    issued = parse_instant(attributes.get(ISSUED_ATTRIBUTE))
    status = attributes.get(STATUS_ATTRIBUTE, 'active') if expires else None
    return {'state': licence_state(expires, now, status), 'tier': tier_of(attributes.get(TIER_ATTRIBUTE)) if expires else None,
            'status': status, 'issued': format_instant(issued) if issued else None,
            'expires': format_instant(expires) if expires else None,
            'permissions': sorted(role for role in user['roles'] if role in PERMISSIONS)}


def public_user(user: dict, now: datetime, logins: dict | None = None, documents: dict | None = None) -> dict:
    login = (logins or {}).get(user['id'])
    return {'id': user['id'], 'username': user['username'], 'firstName': user['firstName'], 'lastName': user['lastName'],
            'name': ' '.join(part for part in (user['firstName'], user['lastName']) if part) or user['username'],
            'email': user['email'], 'enabled': user['enabled'], 'admin': ADMIN_ROLE in user['roles'],
            'created': format_instant(user['created']) if user['created'] else None,
            'lastLogin': format_instant(login) if login else None, 'documents': (documents or {}).get(user['id'], 0),
            'ban': ban_of(user, now), 'licence': licence_of(user, now)}


def lift_expired_bans(port: KeycloakAdmin, audit: AuditLog, now: datetime) -> int:
    """Enables again every account whose temporary ban has ended."""
    lifted = 0
    for user in port.users():
        ban = ban_of(user, now)
        if ban and ban['expired']:
            port.set_attributes(user['id'], {BAN_UNTIL_ATTRIBUTE: None, BAN_REASON_ATTRIBUTE: None})
            port.update_user(user['id'], {'enabled': True})
            audit.record('system', user['id'], 'ban-ended', {}, now)
            lifted += 1
    return lifted


def administration_router(administrator: Callable, keycloak: Callable[[], KeycloakAdmin], store, audit: AuditLog,
                          clock: Callable[[], datetime]) -> APIRouter:
    router = APIRouter(prefix='/api/admin', tags=['admin'])
    Admin = Annotated[dict, Depends(administrator)]

    def not_self(current: dict, user_id: str, action: str):
        if current['subject'] == user_id:
            raise IdentityError(409, f'You cannot {action} your own account')

    async def call(function, *args):
        return await run_in_threadpool(function, *args)

    async def record(current: dict, subject: str, change: str, detail: dict | None = None):
        await call(audit.record, current['subject'], subject, change, detail or {}, clock())

    async def document_counts() -> dict:
        counts: dict[str, int] = {}
        for document in await call(store.describe):
            if document['owner']:
                counts[document['owner']] = counts.get(document['owner'], 0) + 1
        return counts

    async def described(user_id: str) -> dict:
        port = keycloak()
        return public_user(await call(port.get_user, user_id), clock(), await call(port.last_logins), await document_counts())

    # Users (SC-0142, SC-0143).
    @router.get('/users')
    async def users(_: Admin):
        port, now = keycloak(), clock()
        await call(lift_expired_bans, port, audit, now)
        found, logins, counts = await call(port.users), await call(port.last_logins), await document_counts()
        return {'total': len(found), 'users': [public_user(user, now, logins, counts) for user in found]}

    @router.post('/users', status_code=201)
    async def create_user(body: NewUser, current: Admin):
        port = keycloak()
        user_id = await call(port.create_user, body.model_dump())
        if body.admin:
            await call(port.set_role, user_id, ADMIN_ROLE, True)
        await record(current, user_id, 'create-user', {'username': body.username, 'admin': body.admin, 'temporary': body.temporary})
        return await described(user_id)

    @router.patch('/users/{user_id}')
    async def update_user(user_id: str, body: UserChange, current: Admin):
        user_id = valid_user_id(user_id)
        changes = body.model_dump(exclude_none=True)
        if changes:
            await call(keycloak().update_user, user_id, changes)
        await record(current, user_id, 'edit-user', {'fields': sorted(changes)})
        return await described(user_id)

    @router.delete('/users/{user_id}', status_code=204)
    async def delete_user(user_id: str, current: Admin):
        user_id = valid_user_id(user_id)
        not_self(current, user_id, 'delete')
        await call(keycloak().delete_user, user_id)
        await record(current, user_id, 'delete-user')

    @router.put('/users/{user_id}/password')
    async def set_password(user_id: str, body: PasswordChange, current: Admin):
        user_id = valid_user_id(user_id)
        port = keycloak()
        await call(port.set_password, user_id, body.password, body.temporary)
        await call(port.end_sessions, user_id)
        await record(current, user_id, 'overwrite-password', {'temporary': body.temporary})
        return await described(user_id)

    @router.put('/users/{user_id}/ban')
    async def ban(user_id: str, body: Ban, current: Admin):
        user_id = valid_user_id(user_id)
        not_self(current, user_id, 'ban')
        now = clock()
        if body.until is not None and (body.until.tzinfo is None or body.until <= now):
            raise IdentityError(422, 'A temporary ban must end in the future, with a time zone')
        port = keycloak()
        until = format_instant(body.until) if body.until else 'permanent'
        await call(port.set_attributes, user_id, {BAN_UNTIL_ATTRIBUTE: until, BAN_REASON_ATTRIBUTE: body.reason or None})
        await call(port.update_user, user_id, {'enabled': False})
        await call(port.end_sessions, user_id)
        await record(current, user_id, 'ban', {'until': until})
        return await described(user_id)

    @router.delete('/users/{user_id}/ban')
    async def unban(user_id: str, current: Admin):
        user_id = valid_user_id(user_id)
        port = keycloak()
        await call(port.set_attributes, user_id, {BAN_UNTIL_ATTRIBUTE: None, BAN_REASON_ATTRIBUTE: None})
        await call(port.update_user, user_id, {'enabled': True})
        await record(current, user_id, 'lift-ban')
        return await described(user_id)

    # Roles and permissions (SC-0144).
    @router.get('/roles')
    async def roles(_: Admin):
        found = await call(keycloak().users)
        return {'roles': [{'name': role, 'kind': 'role' if role == ADMIN_ROLE else 'permission',
                           'description': ROLE_DESCRIPTIONS[role],
                           'members': sorted(user['id'] for user in found if role in user['roles'])} for role in ROLES]}

    @router.put('/roles/{role}/members/{user_id}')
    async def add_member(role: Role, user_id: str, current: Admin):
        user_id = valid_user_id(user_id)
        await call(keycloak().set_role, user_id, role, True)
        await record(current, user_id, 'grant-role', {'role': role})
        return await described(user_id)

    @router.delete('/roles/{role}/members/{user_id}')
    async def remove_member(role: Role, user_id: str, current: Admin):
        user_id = valid_user_id(user_id)
        if role == ADMIN_ROLE:
            not_self(current, user_id, 'remove the administrator role from')
        await call(keycloak().set_role, user_id, role, False)
        await record(current, user_id, 'revoke-role', {'role': role})
        return await described(user_id)

    # Licences (SC-0138, SC-0145).
    @router.get('/licences')
    async def licences(_: Admin):
        now, found = clock(), await call(keycloak().users)
        rows = []
        for user in found:
            if LICENCE_ATTRIBUTE in user['attributes']:
                public = public_user(user, now)
                rows.append({'userId': user['id'], 'username': public['username'], 'name': public['name'],
                             'email': public['email'], **public['licence']})
        return {'total': len(rows), 'licences': rows}

    async def write_licence(user_id: str, attributes: dict, permissions: list[str] | None) -> None:
        port = keycloak()
        await call(port.set_attributes, user_id, attributes)
        if permissions is not None:
            current = (await call(port.get_user, user_id))['roles']
            for permission in PERMISSIONS:
                wanted = permission in permissions
                if wanted != (permission in current):
                    await call(port.set_role, user_id, permission, wanted)

    @router.put('/users/{user_id}/licence')
    async def issue(user_id: str, body: LicenceRequest, current: Admin):
        user_id = valid_user_id(user_id)
        now = clock()
        expires = licence_expiry(now, body.days, body.until)
        permissions = sorted(set(body.permissions))
        await call(keycloak().get_user, user_id)
        await write_licence(user_id, {LICENCE_ATTRIBUTE: format_instant(expires), ISSUED_ATTRIBUTE: format_instant(now),
                                      STATUS_ATTRIBUTE: 'active', TIER_ATTRIBUTE: body.tier}, permissions)
        await record(current, user_id, 'issue', {'tier': body.tier, 'expires': format_instant(expires), 'permissions': permissions})
        return await described(user_id)

    async def existing_licence(user_id: str) -> dict:
        user = await call(keycloak().get_user, user_id)
        if LICENCE_ATTRIBUTE not in user['attributes']:
            raise IdentityError(409, 'This user has no licence to change; issue one')
        return user

    @router.patch('/users/{user_id}/licence')
    async def change_licence(user_id: str, body: LicenceChange, current: Admin):
        user_id = valid_user_id(user_id)
        await existing_licence(user_id)
        now, attributes = clock(), {}
        if body.days is not None or body.until is not None:
            attributes[LICENCE_ATTRIBUTE] = format_instant(licence_expiry(now, body.days, body.until))
        if body.tier is not None:
            attributes[TIER_ATTRIBUTE] = body.tier
        if body.status is not None:
            attributes[STATUS_ATTRIBUTE] = body.status
        permissions = sorted(set(body.permissions)) if body.permissions is not None else None
        await write_licence(user_id, attributes, permissions)
        await record(current, user_id, 'edit-licence', {**{name.removeprefix('xds_licence_'): value for name, value in attributes.items()},
                                                         **({'permissions': permissions} if permissions is not None else {})})
        return await described(user_id)

    @router.post('/users/{user_id}/licence/extend')
    async def extend(user_id: str, body: ExtendRequest, current: Admin):
        user_id = valid_user_id(user_id)
        user = await existing_licence(user_id)
        expires = extended_expiry(parse_instant(user['attributes'][LICENCE_ATTRIBUTE]), clock(), body.days)
        await write_licence(user_id, {LICENCE_ATTRIBUTE: format_instant(expires)}, None)
        await record(current, user_id, 'extend', {'expires': format_instant(expires)})
        return await described(user_id)

    @router.delete('/users/{user_id}/licence')
    async def revoke(user_id: str, current: Admin):
        user_id = valid_user_id(user_id)
        await call(keycloak().get_user, user_id)
        await write_licence(user_id, {LICENCE_ATTRIBUTE: None, ISSUED_ATTRIBUTE: None, STATUS_ATTRIBUTE: None, TIER_ATTRIBUTE: None}, [])
        await record(current, user_id, 'revoke')
        return await described(user_id)

    # Documents (SC-0146).
    @router.get('/documents')
    async def documents(_: Admin):
        found = await call(store.describe)
        return {'total': len(found), 'documents': found}

    @router.delete('/documents/{document_id}', status_code=204)
    async def delete_document(document_id: str, current: Admin):
        await call(store.delete, document_id)
        await record(current, document_id, 'delete-document')

    return router


__all__ = ['administration_router', 'lift_expired_bans', 'public_user', 'TIERS']

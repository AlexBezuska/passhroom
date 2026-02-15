# Passhroom Design

## Overview

Passhroom is a self-hosted passwordless authentication service for first-party and third-party web apps.

Primary responsibilities:
- accept login start requests (`/v1/auth/start`)
- send one-time magic links over email
- mint short-lived auth codes
- exchange auth codes for tokens (`/v1/auth/token`)

## Core Components

- API service: Node.js + TypeScript + Fastify
- Database: PostgreSQL (users, clients, requests, sessions, codes)
- Optional cache/rate-limit backend: Redis
- SMTP provider: used to deliver login links

## Data Model (high level)

- `clients`: app registrations, redirect allowlists, and client secrets
- `users`: normalized user identities by email
- `login_requests`: login lifecycle and anti-abuse metadata
- `admin_*` tables: admin login/session controls

## Security Design

- One-time codes and tokens are generated with CSPRNG
- Sensitive token values are stored as hashes, not plaintext
- Redirect URIs are strict exact-match allowlisted per client
- HTTPS is expected in production (`REQUIRE_HTTPS=true`)
- Rate limits are applied by IP, email, and client dimensions

## Runtime Topology

A standard self-hosted setup uses:
- reverse proxy (Nginx/Caddy/Traefik)
- Passhroom API container
- Postgres container/service
- optional Redis container/service

The reverse proxy terminates TLS and forwards to Passhroom on an internal or localhost-bound port.

## Operations Boundary

This public repository contains app code and generic deployment docs.

Private infrastructure automation and environment-specific runbooks are intentionally kept outside public runtime requirements (for maintainers, via optional `servertron-docs` submodule).
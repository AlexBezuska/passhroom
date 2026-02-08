import { FastifyInstance } from 'fastify';
import { env } from '../lib/env';
import { pool } from '../lib/db';
import { randomToken, sha256Base64Url } from '../lib/crypto';
import { normalizeEmail } from '../lib/users';
import { sendMagicLinkEmail } from '../lib/email';
import argon2 from 'argon2';

const ADMIN_COOKIE_NAME = 'passhroom_admin';

const ADMIN_EMAILS = new Set(env.admin.emailAllowlist.map((e) => normalizeEmail(e)));

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function page(
  title: string,
  bodyHtml: string,
  options?: {
    htmlClass?: string;
    bodyClass?: string;
  }
): string {
  const accent = '#ff2bd6';
  const htmlClass = options?.htmlClass ? ` class="${htmlEscape(options.htmlClass)}"` : '';
  const bodyClass = options?.bodyClass ? ` class="${htmlEscape(options.bodyClass)}"` : '';
  return `<!doctype html>
<html lang="en"${htmlClass}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(title)}</title>
    <link rel="icon" href="/assets/favicons/favicon-196.png" type="image/png" sizes="196x196" />
    <link rel="apple-touch-icon" href="/assets/favicons/apple-icon-180.png" sizes="180x180" />
    <link rel="manifest" href="/assets/favicons/site.webmanifest" />
    <link rel="shortcut icon" href="/favicon.ico" />
    <style>
      :root {
        --bg: #0b0b10;
        --panel: #12121b;
        --text: #e9e9f1;
        --muted: #a6a6bf;
        --accent: ${accent};
        --border: rgba(255,255,255,0.10);

        --gap: 16px;
        --topH: 64px;

        /* Semantic state (used sparingly; brand stays purple) */
        --success: rgba(58, 208, 120, 1);
        --warning: rgba(245, 158, 11, 1);
        --danger: rgba(239, 68, 68, 1);
        --info: rgba(96, 165, 250, 1);

        --helpText: rgba(233,233,241,0.72);
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif;
        color: var(--text);
        background: radial-gradient(1200px 500px at 50% -10%, rgba(255,43,214,0.22), rgba(0,0,0,0)), var(--bg);
        font-size: 16px;
        line-height: 1.45;
      }
      @media (min-width: 1040px) {
        html.consoleMode, html.consoleMode body { height: 100%; overflow: hidden; }
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .wrap { max-width: 1180px; margin: 0 auto; padding: 22px 16px 28px; }
      body.consoleMode .wrap {
        max-width: 1536px;
        height: 100vh;
        padding: var(--gap);
        display: flex;
        flex-direction: column;
        gap: var(--gap);
        overflow: hidden;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }
      body.consoleMode .top {
        height: var(--topH);
        margin-bottom: 0;
        flex: 0 0 auto;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .brand img {
        width: 48px;
        height: 48px;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
        image-rendering: -moz-crisp-edges;
      }
      .brand h1 { margin: 0; font-size: 22px; letter-spacing: 0.3px; }
      .tag { font-size: 14px; color: var(--muted); }
      .panel {
        background: rgba(18,18,27,0.82);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 20px 70px rgba(0,0,0,0.55);
      }

      /* Console layout (no page scroll; internal panel scroll only) */
      .console {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--gap);
        min-height: 0;
      }
      @media (min-width: 1040px) {
        .console {
          grid-template-columns: 1.55fr 1fr;
        }
      }
      @media (min-width: 1440px) {
        .console {
          grid-template-columns: 1.65fr 1fr;
        }
      }
      body.consoleMode .console {
        flex: 1 1 auto;
        overflow: hidden;
      }
      .col {
        display: flex;
        flex-direction: column;
        gap: var(--gap);
        min-height: 0;
      }
      .panel {
        min-height: 0;
      }
      .panelScroll {
        overflow: auto;
        height: 100%;
        min-height: 0;
      }

      /* Modal */
      .modalBack {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.62);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 22px 16px;
        z-index: 50;
      }
      .modalBack[data-open="1"] { display: flex; }
      .modalPanel {
        width: min(1100px, 100%);
        max-height: min(86vh, 860px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }
      .modalHeader {
        display:flex;
        align-items:center;
        justify-content: space-between;
        gap: 12px;
      }
      .modalClose {
        border: 1px solid var(--border);
        background: rgba(0,0,0,0.18);
        color: var(--text);
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
      }
      .modalClose:hover { border-color: rgba(255,43,214,0.45); }

      h2 { margin: 0; font-size: 18px; }
      p { margin: 0; }
      .small { font-size: 14px; }
      label { display: block; font-size: 14px; color: var(--muted); margin-bottom: 6px; }
      input, textarea {
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: rgba(0,0,0,0.22);
        color: var(--text);
        padding: 12px 12px;
        font-size: 16px;
        outline: none;
      }
      select {
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: rgba(0,0,0,0.22);
        color: var(--text);
        padding: 12px 12px !important;
        font-size: 16px !important;
        outline: none;
      }
      textarea { min-height: 110px; resize: vertical; }
      input:focus, textarea:focus {
        border-color: rgba(255,43,214,0.55);
        box-shadow: 0 0 0 3px rgba(255,43,214,0.16);
      }
      select:focus {
        border-color: rgba(255,43,214,0.55);
        box-shadow: 0 0 0 3px rgba(255,43,214,0.16);
      }
      .row { display: grid; grid-template-columns: 1fr; gap: 10px; }
      @media (min-width: 700px) { .row { grid-template-columns: 1fr 1fr; } }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid rgba(255,43,214,0.55);
        background: linear-gradient(180deg, rgba(255,43,214,0.22), rgba(255,43,214,0.08));
        color: var(--text);
        cursor: pointer;
        font-weight: 600;
        font-size: 16px;
      }
      .btn:active { transform: translateY(1px); }
      .muted { color: var(--muted); }
      .hr { height: 1px; background: var(--border); margin: 14px 0; }

      .panelTitle { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .stack { display: flex; flex-direction: column; gap: 10px; }
      .field { margin-top: 10px; }
      .field:first-child { margin-top: 0; }
      .help { margin: -2px 0 6px; font-size: 13px; color: var(--helpText); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .help strong { color: var(--text); font-weight: 600; }
      .hintIcon { display: inline-block; width: 18px; text-align: center; color: var(--muted); }
      .btnRow { margin-top: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      fieldset {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
        margin: 0;
      }
      legend { padding: 0 8px; color: var(--text); font-weight: 700; font-size: 15px; letter-spacing: 0.2px; }
      fieldset + fieldset { margin-top: 12px; }

      .tabs { display: flex; gap: 8px; }
      .tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        color: var(--muted);
        font-size: 14px;
        text-decoration: none;
      }
      .tab[aria-current="page"] {
        color: var(--text);
        border-color: rgba(255,43,214,0.55);
        background: rgba(255,43,214,0.10);
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        font-size: 14px;
        color: var(--muted);
        background: rgba(255,255,255,0.03);
      }
      .chip[data-tone="success"] { border-color: rgba(58,208,120,0.55); color: rgba(58,208,120,0.95); }
      .chip[data-tone="warning"] { border-color: rgba(245,158,11,0.65); color: rgba(245,158,11,0.95); }
      .chip[data-tone="danger"] { border-color: rgba(239,68,68,0.65); color: rgba(239,68,68,0.95); }
      .chip[data-tone="info"] { border-color: rgba(96,165,250,0.65); color: rgba(96,165,250,0.95); }

      .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 10px; font-size: 14px; }
      .k { color: var(--muted); }
      .v { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .v code { white-space: nowrap; }
      .copyBtn {
        margin-left: 8px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.04);
        color: var(--text);
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 14px;
      }
      .copyBtn:active { transform: translateY(1px); }

      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .denseTable th, .denseTable td { padding: 8px 8px; }
      .listBtn {
        display: block;
        width: 100%;
        text-align: left;
        padding: 10px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: rgba(0,0,0,0.18);
        color: var(--text);
        cursor: pointer;
      }
      .listBtn:hover { border-color: rgba(255,255,255,0.16); }
      .listBtn .sub { color: var(--muted); font-size: 14px; margin-top: 2px; }

      details > summary { cursor: pointer; color: var(--text); font-weight: 700; }
      details > summary::marker { color: var(--muted); }

      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 8px; border-bottom: 1px solid var(--border); text-align: left; font-size: 15px; }
      th { color: var(--muted); font-weight: 600; }
      .pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--border);
        color: var(--muted);
        font-size: 14px;
      }
      code {
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--border);
        padding: 2px 6px;
        border-radius: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 14px;
      }
      pre {
        background: rgba(0,0,0,0.25);
        border: 1px solid var(--border);
        padding: 12px;
        border-radius: 12px;
        overflow: auto;
      }
    </style>
  </head>
  <body${bodyClass}>
    <div class="wrap">
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

type AdminSession = { email_normalized: string; expires_at: Date };

async function requireAdmin(app: FastifyInstance, req: any): Promise<AdminSession | null> {
  if (!env.admin.enabled) return null;

  if (env.admin.requireHeaderName && env.admin.requireHeaderValue) {
    const provided = (req.headers[env.admin.requireHeaderName.toLowerCase()] as string | undefined) ?? '';
    if (provided !== env.admin.requireHeaderValue) return null;
  }

  const tokenRaw = req.cookies?.[ADMIN_COOKIE_NAME] as string | undefined;
  if (!tokenRaw) return null;

  const tokenHash = sha256Base64Url(tokenRaw);
  const found = await pool.query(
    `SELECT email_normalized, expires_at
     FROM admin_sessions
     WHERE session_token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  if (found.rowCount !== 1) return null;
  const row = found.rows[0] as AdminSession;
  if (row.expires_at.getTime() <= Date.now()) return null;
  if (!ADMIN_EMAILS.has(row.email_normalized)) return null;
  return row;
}

export async function registerAdmin(app: FastifyInstance): Promise<void> {
  function parseJsonSafe(text: string): any | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function statusToneFromHttp(code: number): 'success' | 'warning' | 'danger' | 'info' {
    if (code >= 200 && code < 300) return 'success';
    if (code === 429) return 'warning';
    if (code >= 400) return 'danger';
    return 'info';
  }

  function friendlyErrorFromApiBody(body: any): string | undefined {
    const err = String(body?.error ?? '');
    if (!err) return undefined;
    if (err === 'invalid_client') return 'Unknown or disabled client. Create/enable the client and try again.';
    if (err === 'invalid_redirect_uri') return 'Callback URL is not allowlisted for this app (exact match required).';
    if (err === 'rate_limited') return 'Rate-limited. Wait a bit and retry.';
    if (err === 'invalid_client_secret') return 'Client secret is wrong.';
    if (err === 'invalid_code') return 'Code is invalid (wrong, already used, or for a different callback URL).';
    if (err === 'code_used') return 'That code was already used.';
    if (err === 'code_expired') return 'That code expired. Restart from step 1.';
    return `Error: ${err}`;
  }

  function isValidHttpUrl(value: string): boolean {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function renderConsole(args: {
    sessionEmail: string;
    totalUsers: number;
    tab: 'users' | 'activity' | 'apps';
    usersRowsHtml: string;
    usersQuery: string;
    usersPage: number;
    usersPageSize: number;
    usersTotalMatching: number;
    clients: Array<{ client_id: string; redirect_uris: string[]; is_enabled: boolean }>;
    clientsQuery: string;
    activity: Array<{
      kind: string;
      ts: string;
      client_id: string;
      email: string;
      redirect_uri: string;
      state: string;
      lr_id?: string;
      ac_id?: string;
    }>;
    activityClientId: string;
    activityEmailPrefix: string;
    form: {
      client_id?: string;
      email?: string;
      redirect_uri?: string;
      state?: string;
      app_name?: string;
      app_return_to?: string;
      code?: string;
      client_secret?: string;
    };
    output?: {
      lastAction: string;
      httpStatus: number;
      retryAfterSeconds?: number;
      userCreated?: boolean;
      client_id?: string;
      redirect_uri?: string;
      email?: string;
      requestId: string;
      timestampIso: string;
      responseText: string;
      responseJson: any | null;
      friendlyError?: string;
    };
  }): string {
    const clientsJson = JSON.stringify(
      args.clients.map((c) => ({ client_id: c.client_id, redirect_uris: c.redirect_uris, is_enabled: c.is_enabled }))
    );
    const activityJson = JSON.stringify(args.activity);

    // Safe to embed in <script type="application/json"> without HTML-escaping quotes.
    // We only need to prevent "</script"-style breakouts.
    const clientsJsonSafe = clientsJson.replaceAll('<', '\\u003c');
    const activityJsonSafe = activityJson.replaceAll('<', '\\u003c');

    const output = args.output;
    const tone = output ? statusToneFromHttp(output.httpStatus) : 'info';
    const statusLabel =
      !output
        ? 'No runs yet'
        : output.httpStatus >= 200 && output.httpStatus < 300
          ? 'Success'
          : output.httpStatus === 429
            ? 'Rate-limited'
            : 'Error';

    const userCreatedText = output?.userCreated === true ? 'Yes' : output?.userCreated === false ? 'No' : '—';
    const lastActionText = output?.lastAction ?? '—';
    const step1Ok = output?.lastAction === 'send_magic_link' && output.httpStatus >= 200 && output.httpStatus < 300;

    const safeUsersQuery = htmlEscape(args.usersQuery);
    const selectedClientId = htmlEscape(args.form.client_id ?? '');
    const selectedEmail = htmlEscape(args.form.email ?? '');
    const selectedRedirect = htmlEscape(args.form.redirect_uri ?? '');
    const selectedState = htmlEscape(args.form.state ?? '');
    const selectedAppName = htmlEscape(args.form.app_name ?? '');
    const selectedAppReturnTo = htmlEscape(args.form.app_return_to ?? '');
    const selectedCode = htmlEscape(args.form.code ?? '');
    const selectedClientSecret = htmlEscape(args.form.client_secret ?? '');

    const outputJsonPretty = output?.responseJson ? htmlEscape(JSON.stringify(output.responseJson, null, 2)) : '';
    const outputRaw = output ? htmlEscape(output.responseText || '') : '';

    const usersPageCount = Math.max(1, Math.ceil(args.usersTotalMatching / Math.max(1, args.usersPageSize)));
    const usersPage = Math.min(Math.max(args.usersPage, 1), usersPageCount);
    const usersPrev = usersPage > 1 ? usersPage - 1 : null;
    const usersNext = usersPage < usersPageCount ? usersPage + 1 : null;

    const appsItems = args.clients
      .map((c) => {
        const badge = c.is_enabled
          ? `<span class="chip" data-tone="success">Enabled</span>`
          : `<span class="chip" data-tone="warning">Disabled</span>`;
        const cbCount = c.redirect_uris.length;
        const isSelected = (args.form.client_id ?? '') === c.client_id;
        return `<button class="listBtn" type="button" data-app="${htmlEscape(c.client_id)}" style="border-color:${
          isSelected ? 'rgba(255,43,214,0.55)' : 'var(--border)'
        }">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div><code>${htmlEscape(c.client_id)}</code></div>
            <div style="display:flex; gap:8px; align-items:center;">${badge}<span class="pill">${cbCount} callback${
              cbCount === 1 ? '' : 's'
            }</span></div>
          </div>
        </button>`;
      })
      .join('');

    const activityItems = args.activity
      .map((ev, idx) => {
        const title = `${ev.kind} · ${ev.email}`;
        const sub = `${ev.ts} · ${ev.client_id}`;
        const payload = htmlEscape(JSON.stringify(ev));
        return `<button class="listBtn" type="button" data-activity="${payload}" data-idx="${idx}">
          <div>${htmlEscape(title)}</div>
          <div class="sub">${htmlEscape(sub)}</div>
        </button>`;
      })
      .join('');

    return page(
      'Passhroom Admin',
      `<div class="top">
        <div class="brand">
          <img src="/assets/poison-shroom.png" alt="" />
          <h1>Passhroom</h1>
          <span class="pill">admin</span>
          <span class="tag">${htmlEscape(args.sessionEmail)}</span>
        </div>
        <div style="display:flex; gap:12px; align-items:center">
          <span class="pill">Users: ${args.totalUsers}</span>
          <button class="btn" type="button" id="open_test_modal" title="Opens the sign-in test tool">Test sign-in</button>
          <a href="/admin/logout">Sign out</a>
        </div>
      </div>

      <div class="console" data-step1-ok="${step1Ok ? '1' : '0'}">
        <!-- Left: Data (Users / Activity) -->
        <div class="col">
          <div class="panel" style="display:flex; flex-direction:column; gap:12px; min-height:0;">
            <div class="panelTitle">
              <h2>Data</h2>
              <div class="tabs">
                <a class="tab" href="/admin/?tab=users&q=${encodeURIComponent(args.usersQuery)}" aria-current="${args.tab === 'users' ? 'page' : 'false'}">Users</a>
                <a class="tab" href="/admin/?tab=apps" aria-current="${args.tab === 'apps' ? 'page' : 'false'}">Apps</a>
                <a class="tab" href="/admin/?tab=activity&ac=${encodeURIComponent(args.activityClientId)}&ae=${encodeURIComponent(args.activityEmailPrefix)}" aria-current="${args.tab === 'activity' ? 'page' : 'false'}">Activity</a>
              </div>
            </div>

            <div class="panelScroll" style="min-height:0;">
              ${
                args.tab === 'users'
                  ? `<form method="get" action="/admin/" style="margin-bottom:10px">
                      <input type="hidden" name="tab" value="users" />
                      <label for="q">Search email</label>
                      <input id="q" name="q" placeholder="alex@example.com" value="${safeUsersQuery}" autocapitalize="off" spellcheck="false" />
                      <div class="help" title="Searches by email prefix. Empty = newest users."><span class="hintIcon">ⓘ</span>Search by email (prefix). Empty shows newest.</div>
                      <div class="btnRow" style="margin-top:8px">
                        <button class="btn" type="submit">Search</button>
                        <a class="muted" href="/admin/?tab=users">Clear</a>
                        <a class="muted" href="/admin/users.csv?q=${encodeURIComponent(args.usersQuery)}">Export CSV</a>
                      </div>
                      <div class="btnRow" style="margin-top:8px">
                        ${usersPrev ? `<a class="tab" href="/admin/?tab=users&q=${encodeURIComponent(args.usersQuery)}&page=${usersPrev}">← Prev</a>` : `<span class="muted small">← Prev</span>`}
                        <span class="muted small">Page ${usersPage} / ${usersPageCount}</span>
                        ${usersNext ? `<a class="tab" href="/admin/?tab=users&q=${encodeURIComponent(args.usersQuery)}&page=${usersNext}">Next →</a>` : `<span class="muted small">Next →</span>`}
                      </div>
                    </form>

                    <form method="post" action="/admin/users/create" style="margin-bottom:10px">
                      <label for="create_email">Create user (manual)</label>
                      <div class="help" title="Creates the user row only (no email is sent)."><span class="hintIcon">ⓘ</span>Pre-provision a user by email.</div>
                      <div style="display:flex; gap:10px; align-items:center;">
                        <input id="create_email" name="email" placeholder="newuser@example.com" autocomplete="email" autocapitalize="off" spellcheck="false" required />
                        <button class="btn" type="submit">Create</button>
                      </div>
                    </form>

                    <table class="denseTable">
                      <thead><tr><th>Email</th><th>Last login (UTC)</th><th>Last app</th></tr></thead>
                      <tbody>${args.usersRowsHtml || '<tr><td colspan="3" class="muted">No users yet. Use the flow to send a test sign-in email.</td></tr>'}</tbody>
                    </table>`
                  : args.tab === 'activity'
                    ? `<form method="get" action="/admin/" style="margin-bottom:10px">
                        <input type="hidden" name="tab" value="activity" />
                        <div class="row">
                          <div>
                            <label for="ac">App</label>
                            <select id="ac" name="ac" style="width:100%; border-radius:10px; border:1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--text); padding: 8px 10px;">
                              <option value="">All apps</option>
                              ${args.clients
                                .map((c) => {
                                  const isSelected = args.activityClientId === c.client_id;
                                  return `<option value="${htmlEscape(c.client_id)}" ${isSelected ? 'selected' : ''}>${htmlEscape(c.client_id)}</option>`;
                                })
                                .join('')}
                            </select>
                          </div>
                          <div>
                            <label for="ae">Email prefix</label>
                            <input id="ae" name="ae" placeholder="alex@" value="${htmlEscape(args.activityEmailPrefix)}" autocapitalize="off" spellcheck="false" />
                          </div>
                        </div>
                        <div class="btnRow" style="margin-top:8px">
                          <button class="btn" type="submit">Filter</button>
                          <a class="muted" href="/admin/?tab=activity">Clear</a>
                        </div>
                      </form>
                      <div class="help" title="Derived from login_requests and auth_codes tables."><span class="hintIcon">ⓘ</span>Latest auth events (click one to load).</div>
                      <div class="stack" style="margin-top:10px">${activityItems || '<div class="muted">No recent activity.</div>'}</div>`
                    : (() => {
                        const selected = (args.form.client_id ?? '').trim();
                        const selectedClient = selected ? args.clients.find((c) => c.client_id === selected) : undefined;
                        const callbacks = selectedClient?.redirect_uris ?? [];
                        const selectedSecret = (selectedClient as any)?.client_secret_plain as string | null | undefined;

                        return `<div class="help" style="white-space:normal" title="These values come from your app’s OAuth-style integration."><span class="hintIcon">ⓘ</span>
                          <strong>App ID</strong> is the identifier your app sends to Passhroom (as <span class="mono">client_id</span>) when it calls <span class="mono">/v1/auth/start</span> and <span class="mono">/v1/auth/token</span>.
                          <br/><strong>Callback URL</strong> is where Passhroom redirects the user after they click the magic link (Passhroom appends <span class="mono">?code=…&state=…</span>). It must exactly match an allowlisted callback URL.
                        </div>

                        <form method="post" action="/admin/apps/create" style="margin-bottom:10px; margin-top:10px">
                          <label for="new_client_id">Create app</label>
                          <div class="help" style="white-space:normal" title="Creates a new app (client) and shows the one-time secret in Run Output."><span class="hintIcon">ⓘ</span>
                            Create an integration for one app/service. You’ll copy the one-time <span class="mono">client_secret</span> into your app’s config.
                          </div>
                          <div class="row" style="margin-top:8px">
                            <div>
                              <label class="small" for="new_client_id">App ID (client_id)</label>
                              <input id="new_client_id" name="client_id" placeholder="my-app" autocapitalize="off" spellcheck="false" required />
                              <div class="help" style="white-space:normal" title="Your app will use this as client_id."><span class="hintIcon">ⓘ</span>
                                Put this in your app config as <span class="mono">PASSHROOM_CLIENT_ID</span> (or similar).
                              </div>
                            </div>
                            <div>
                              <label class="small" for="new_is_enabled">Enabled</label>
                              <select id="new_is_enabled" name="is_enabled" style="width:100%; border-radius:10px; border:1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--text); padding: 8px 10px;">
                                <option value="true" selected>Enabled</option>
                                <option value="false">Disabled</option>
                              </select>
                            </div>
                          </div>
                          <div class="field" style="margin-top:8px">
                            <label class="small" for="new_redirects">Callback URLs (redirect_uris; one per line)</label>
                            <textarea id="new_redirects" name="redirect_uris" rows="4" placeholder="https://myapp.example.com/passhroom/callback" style="width:100%; border-radius:10px; border:1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--text); padding: 8px 10px; resize:vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"></textarea>
                            <div class="help" style="white-space:normal" title="Passhroom will redirect the user to one of these after the email link is clicked."><span class="hintIcon">ⓘ</span>
                              Your app must have a route at this URL to receive <span class="mono">code</span> and <span class="mono">state</span>, then call <span class="mono">/v1/auth/token</span>.
                            </div>
                          </div>
                          <div class="btnRow" style="margin-top:8px">
                            <button class="btn" type="submit">Create app</button>
                          </div>
                        </form>

                        <div style="height:1px; background:var(--border); margin: 10px 0;"></div>

                        ${selected
                          ? `<div class="panel" style="padding:12px; border:1px solid var(--border); background: rgba(0,0,0,0.16);">
                              <div class="help" title="Click an app on the list to load it."><span class="hintIcon">ⓘ</span><strong>Selected app</strong>: <code id="apps_selected_label">${htmlEscape(
                                selected
                              )}</code></div>

                              <div style="margin-top:10px">
                                <label class="small">App secret (client_secret)</label>
                                ${selectedSecret
                                  ? `<div style="display:flex; gap:10px; align-items:center;">
                                      <code style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:1px solid var(--border); background: rgba(0,0,0,0.18); border-radius: 12px; padding: 10px;">${htmlEscape(
                                        selectedSecret
                                      )}</code>
                                      <button class="copyBtn" type="button" data-copy="${htmlEscape(selectedSecret)}">Copy</button>
                                    </div>
                                    <div class="help" style="white-space:normal" title="This instance stores secrets so admins can view them later."><span class="hintIcon">ⓘ</span>
                                      This is the current secret. Anyone with it can exchange auth codes for user info.
                                    </div>`
                                  : `<div class="muted small">No secret stored for this app (older apps were hash-only). Rotate the secret to generate/store a new one.</div>`}
                              </div>

                              <div class="btnRow" style="margin-top:10px">
                                <form method="post" action="/admin/apps/rotate-secret" style="margin:0">
                                  <input class="appsClientId" type="hidden" name="client_id" value="${htmlEscape(selected)}" />
                                  <button class="btn" type="submit">Rotate secret</button>
                                </form>
                                <form method="post" action="/admin/apps/set-enabled" style="margin:0; display:flex; gap:10px; align-items:center;">
                                  <input class="appsClientId" type="hidden" name="client_id" value="${htmlEscape(selected)}" />
                                  <select name="is_enabled" style="border-radius:10px; border:1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--text); padding: 8px 10px;">
                                    <option value="true" ${selectedClient?.is_enabled ? 'selected' : ''}>Enabled</option>
                                    <option value="false" ${selectedClient?.is_enabled ? '' : 'selected'}>Disabled</option>
                                  </select>
                                  <button class="btn" type="submit">Save</button>
                                </form>
                              </div>

                              <form method="post" action="/admin/apps/add-callback" style="margin-top:10px">
                                <input class="appsClientId" type="hidden" name="client_id" value="${htmlEscape(selected)}" />
                                <label class="small" for="add_cb">Add callback URL</label>
                                <div style="display:flex; gap:10px; align-items:center;">
                                  <input id="add_cb" name="redirect_uri" placeholder="https://example.com/auth/callback" autocapitalize="off" spellcheck="false" required />
                                  <button class="btn" type="submit">Add</button>
                                </div>
                              </form>

                              <div style="margin-top:10px">
                                <div class="help" title="Exact match is required."><span class="hintIcon">ⓘ</span>Callback allowlist</div>
                                ${callbacks.length
                                  ? `<div class="stack" style="margin-top:8px">
                                      ${callbacks
                                        .map((u) => {
                                          return `<div style="display:flex; gap:10px; align-items:center; justify-content:space-between; border:1px solid var(--border); background: rgba(0,0,0,0.12); border-radius:12px; padding:8px 10px;">
                                            <div style="min-width:0; flex:1;"><code style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${htmlEscape(
                                              u
                                            )}</code></div>
                                            <form method="post" action="/admin/apps/remove-callback" style="margin:0">
                                              <input class="appsClientId" type="hidden" name="client_id" value="${htmlEscape(selected)}" />
                                              <input type="hidden" name="redirect_uri" value="${htmlEscape(u)}" />
                                              <button class="btn" type="submit">Remove</button>
                                            </form>
                                          </div>`;
                                        })
                                        .join('')}
                                    </div>`
                                  : '<div class="muted small" style="margin-top:8px">No callbacks allowlisted.</div>'}
                              </div>
                            </div>`
                          : `<div class="help" title="Select an app to manage callbacks and secrets."><span class="hintIcon">ⓘ</span>Click an app to manage it (rotate secret, enable/disable, callbacks).</div>`}

                        <div class="help" title="Apps are called clients in the database." style="margin-top:10px"><span class="hintIcon">ⓘ</span>Apps (enabled/disabled + callback allowlist).</div>
                        <div class="stack" style="margin-top:10px">${appsItems || '<div class="muted">No apps found.</div>'}</div>`;
                      })()
              }
            </div>
          </div>
        </div>

        <!-- Right: Run Output -->
        <div class="col">
          <div class="panel" style="display:flex; flex-direction:column; gap:12px; min-height:0; flex:1 1 auto;">
            <div class="panelTitle">
              <h2>Run Output</h2>
              <span class="chip" data-tone="${tone}">${htmlEscape(statusLabel)}</span>
            </div>

            <div class="panelScroll" style="min-height:0; flex:1 1 auto;">
            ${
              !output
                ? `<div class="help" style="white-space:normal" title="Select a user/app, filter activity, or run a test."><span class="hintIcon">ⓘ</span>
                    This panel shows results from admin actions (create app, rotate secret, enable/disable, filters, sign-in test).
                  </div>
                  <div class="muted" style="margin-top:10px">No output yet.</div>`
                : ''
            }
            <div class="kv">
              <div class="k">Last action</div>
              <div class="v" id="out_last_action" title="${htmlEscape(lastActionText)}">${htmlEscape(lastActionText)}</div>

              <div class="k">HTTP</div>
              <div class="v" id="out_http">${output ? `<span class="chip" data-tone="${tone}" id="out_http_chip">${output.httpStatus}</span>` : '—'}</div>

              <div class="k">User created</div>
              <div class="v" id="out_user_created">${htmlEscape(userCreatedText)}</div>

              <div class="k">Client</div>
              <div class="v" id="out_client" title="${htmlEscape(output?.client_id ?? args.form.client_id ?? '')}">
                <code id="out_client_code">${htmlEscape(output?.client_id ?? args.form.client_id ?? '—')}</code>
                <button class="copyBtn" type="button" id="out_client_copy" data-copy="${htmlEscape(output?.client_id ?? args.form.client_id ?? '')}">Copy</button>
              </div>

              <div class="k">Callback URL</div>
              <div class="v" id="out_redirect" title="${htmlEscape(output?.redirect_uri ?? args.form.redirect_uri ?? '')}">
                <code id="out_redirect_code">${htmlEscape(output?.redirect_uri ?? args.form.redirect_uri ?? '—')}</code>
                <button class="copyBtn" type="button" id="out_redirect_copy" data-copy="${htmlEscape(output?.redirect_uri ?? args.form.redirect_uri ?? '')}">Copy</button>
              </div>

              <div class="k">Timestamp</div>
              <div class="v" id="out_ts">${htmlEscape(output?.timestampIso ?? '—')}</div>

              <div class="k">Request ID</div>
              <div class="v" id="out_reqid"><code id="out_reqid_code">${htmlEscape(output?.requestId ?? '—')}</code>
                ${output?.requestId ? `<button class="copyBtn" type="button" id="out_reqid_copy" data-copy="${htmlEscape(output.requestId)}">Copy</button>` : ''}
              </div>
            </div>

            ${
              output?.friendlyError
                ? `<div class="chip" data-tone="danger" title="Raw error is below">${htmlEscape(output.friendlyError)}</div>`
                : ''
            }

            ${
              output
                ? `<div style="min-height:0; border: 1px solid var(--border); border-radius: 12px; padding: 10px; background: rgba(0,0,0,0.16);" id="out_payload">
              <details>
                <summary class="small">Response JSON</summary>
                ${
                  output?.responseJson
                    ? `<pre style="margin:10px 0 0 0" id="out_json">${outputJsonPretty}</pre>`
                    : `<div class="muted" style="margin-top:8px" id="out_json">No JSON to display yet.</div>`
                }
              </details>

              <details style="margin-top:10px">
                <summary class="small">Raw response / error</summary>
                <pre style="margin:10px 0 0 0" id="out_raw">${outputRaw || '—'}</pre>
              </details>
            </div>`
                : ''
            }

            ${
              output?.responseJson?.user_id || output?.responseJson?.email
                ? `<div style="display:flex; gap:10px; flex-wrap:wrap;">
                    ${output.responseJson?.user_id ? `<button class="copyBtn" type="button" data-copy="${htmlEscape(String(output.responseJson.user_id))}">Copy user_id</button>` : ''}
                    ${output.responseJson?.email ? `<button class="copyBtn" type="button" data-copy="${htmlEscape(String(output.responseJson.email))}">Copy email</button>` : ''}
                  </div>`
                : ''
            }
            </div>
          </div>
        </div>
      </div>

      <div class="modalBack" id="test_modal_back" data-open="0" aria-hidden="true">
        <div class="panel modalPanel" role="dialog" aria-modal="true" aria-label="Sign-in test">
          <div class="modalHeader">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <h2 style="margin:0">Sign-in test</h2>
              <span class="chip" data-tone="info">Inputs → Callback → Verify</span>
            </div>
            <button class="modalClose" type="button" id="close_test_modal">Close</button>
          </div>

          <div class="panelScroll" style="min-height:0;">
            <div class="help" title="These forms call the real API endpoints server-side."><span class="hintIcon">ⓘ</span>Runs against the live backend (no mocks).</div>

            <details style="margin-top:4px">
              <summary class="small">Manual mode</summary>
              <div class="help" style="white-space:normal" title="Enable if you want to paste a callback URL and exchange without running step 1.">
                <span class="hintIcon">ⓘ</span><strong>Manual mode</strong> lets you do step 2/3 without step 1.
              </div>
              <label style="display:flex; gap:10px; align-items:center; margin-top:6px">
                <input id="manual_mode" type="checkbox" style="width:auto" />
                <span class="small muted">Enable manual mode</span>
              </label>
            </details>

            <form method="post" action="/admin/test/start">
              <fieldset>
                <legend>1) Send sign-in email</legend>
                <div class="help" title="Calls /v1/auth/start and sends an email."><span class="hintIcon">ⓘ</span>Sends a sign-in email and waits for the callback.</div>

                <div class="row" style="margin-top:10px">
                  <div>
                    <label for="client_select">App</label>
                    <div class="help" title="Created via CLI. Disabled clients will fail."><span class="hintIcon">ⓘ</span>Pick the app.</div>
                    <div style="display:flex; gap:10px; align-items:center;">
                      <select id="client_select" name="client_id" required style="flex:1; width:100%; border-radius:10px; border:1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--text); padding: 8px 10px;">
                      <option value="" ${selectedClientId ? '' : 'selected'} disabled>Select an app…</option>
                      ${args.clients
                        .map((c) => {
                          const label = `${c.client_id}`;
                          const extra = `${c.redirect_uris.length} callback${c.redirect_uris.length === 1 ? '' : 's'}${c.is_enabled ? '' : ' · DISABLED'}`;
                          const isSelected = (args.form.client_id ?? '') === c.client_id;
                          return `<option value="${htmlEscape(c.client_id)}" data-enabled="${c.is_enabled ? '1' : '0'}" ${isSelected ? 'selected' : ''}>${htmlEscape(label)} (${htmlEscape(extra)})</option>`;
                        })
                        .join('')}
                      </select>
                      <label class="small" style="display:flex; gap:8px; align-items:center; margin:0; white-space:nowrap;">
                        <input id="show_disabled_apps" type="checkbox" style="width:auto" />
                        <span class="muted">Show disabled</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label for="user_email">User email</label>
                    <div class="help" title="Where the magic link is sent."><span class="hintIcon">ⓘ</span>Email to send the link to.</div>
                    <input id="user_email" name="email" type="email" placeholder="user@example.com" value="${selectedEmail}" autocomplete="email" autocapitalize="off" spellcheck="false" required />
                  </div>
                </div>

                <div class="field">
                  <label for="redirect_select">Callback URL</label>
                  <div class="help" title="Exact match is required."><span class="hintIcon">ⓘ</span>Must exactly match an allowlisted callback URL.</div>

                  <div style="display:flex; gap:10px; align-items:center;">
                    <div style="flex:1">
                      <select id="redirect_select" name="redirect_uri" required style="width:100%; border-radius:10px; border:1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--text); padding: 8px 10px;">
                        <option value="" ${selectedRedirect ? '' : 'selected'} disabled>Select a callback URL…</option>
                      </select>
                      <input id="redirect_custom" name="redirect_uri_custom" placeholder="https://yourapp.example/auth/callback" value="" inputmode="url" autocapitalize="off" spellcheck="false" style="display:none" />
                    </div>
                    <label class="small" style="display:flex; gap:8px; align-items:center; margin:0; white-space:nowrap;">
                      <input id="redirect_custom_toggle" type="checkbox" style="width:auto" />
                      <span class="muted">Custom (danger)</span>
                    </label>
                  </div>
                  <div class="help" title="You can paste a callback URL in step 2 and we will extract code/state."><span class="hintIcon">ⓘ</span>Tip: paste your callback URL in step 2 to auto-extract <span class="mono">code</span> and <span class="mono">state</span>.</div>
                </div>

                <details style="margin-top:10px">
                  <summary class="small">Advanced (optional)</summary>

                  <div class="row" style="margin-top:10px">
                    <div>
                      <label for="state_input">State</label>
                      <div class="help" title="Your app should verify this."><span class="hintIcon">ⓘ</span>Auto-generated; your app should verify it.</div>
                      <div style="display:flex; gap:10px; align-items:center;">
                        <input id="state_input" name="state" value="${selectedState}" autocapitalize="off" spellcheck="false" required />
                        <button class="copyBtn" type="button" id="regen_state" title="Generate a new random state">↻</button>
                      </div>
                    </div>
                    <div>
                      <label for="app_name">App name</label>
                      <div class="help" title="Shown in the email."><span class="hintIcon">ⓘ</span>Shown in the email.</div>
                      <input id="app_name" name="app_name" placeholder="My App" value="${selectedAppName}" autocapitalize="off" spellcheck="false" />
                    </div>
                  </div>

                  <div class="field">
                    <label for="app_return_to">App return URL (optional)</label>
                    <div class="help" title="Optional."><span class="hintIcon">ⓘ</span>Optional: where your app wants to send the user after sign-in.</div>
                    <input id="app_return_to" name="app_return_to" placeholder="/settings" value="${selectedAppReturnTo}" autocapitalize="off" spellcheck="false" />
                  </div>
                </details>

                <div class="btnRow">
                  <button class="btn" type="submit">Send email</button>
                  ${
                    output && output.lastAction === 'send_magic_link' && output.httpStatus >= 200 && output.httpStatus < 300
                      ? `<span class="chip" data-tone="success">✅ Email sent · User created: ${htmlEscape(userCreatedText)}</span><span class="muted">Waiting for callback…</span>`
                      : output && output.lastAction === 'send_magic_link' && output.httpStatus === 429
                        ? `<span class="chip" data-tone="warning">⏳ Rate-limited</span>${
                            typeof output.retryAfterSeconds === 'number'
                              ? `<span class="muted">Retry after ~${output.retryAfterSeconds}s</span>`
                              : `<span class="muted">Try again soon.</span>`
                          }`
                        : ''
                  }
                </div>
              </fieldset>
            </form>

            <form method="post" action="/admin/test/token" id="finish_form" style="margin-top:12px">
              <fieldset id="finish_step">
                <legend>2) Finish sign-in</legend>
                <div class="help" title="Paste the full URL your app received at the redirect_uri."><span class="hintIcon">ⓘ</span>Paste the callback URL, then verify.</div>

                <div class="field">
                  <label for="callback_url">Callback URL</label>
                  <div style="display:flex; gap:10px; align-items:center;">
                    <input id="callback_url" placeholder="https://yourapp.example/auth/callback?code=…&state=…" inputmode="url" autocapitalize="off" spellcheck="false" />
                    <button class="copyBtn" type="button" id="paste_clipboard" title="Paste callback URL from clipboard">Paste</button>
                  </div>
                </div>

                <div class="row" style="margin-top:10px">
                  <div>
                    <label for="code_extracted">Code</label>
                    <input id="code_extracted" placeholder="code" value="${selectedCode}" autocapitalize="off" spellcheck="false" />
                  </div>
                  <div>
                    <label for="state_extracted">State</label>
                    <input id="state_extracted" placeholder="state" value="" autocapitalize="off" spellcheck="false" />
                  </div>
                </div>
                <div id="state_warning" class="help" style="display:none; color: rgba(239,68,68,0.95);" title="Your app should verify state to prevent CSRF."><span class="hintIcon">⚠</span>State does not match what you sent in step 1.</div>

                <input type="hidden" name="code" id="code_hidden" value="${selectedCode}" />
                <input type="hidden" name="redirect_uri" id="redirect_hidden" value="${selectedRedirect}" />
                <input type="hidden" name="client_id" id="client_hidden" value="${selectedClientId}" />

                <div class="field">
                  <label for="client_secret">App secret</label>
                  <div class="help" title="Printed once when you created the app."><span class="hintIcon">ⓘ</span>Keep this private (not stored in plain text).</div>
                  <input id="client_secret" name="client_secret" type="password" placeholder="••••••••••••••••" value="${selectedClientSecret}" autocomplete="off" autocapitalize="off" spellcheck="false" required />
                </div>

                <div class="btnRow">
                  <button class="btn" type="submit" id="verify_btn">Verify callback</button>
                  <span class="muted" id="verify_help">Paste a callback URL first.</span>
                  <label class="small" style="display:flex; gap:8px; align-items:center; margin:0; white-space:nowrap;">
                    <input id="auto_verify" type="checkbox" style="width:auto" />
                    <span class="muted">Auto-verify</span>
                  </label>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      </div>

      <script type="application/json" id="clients_json">${clientsJsonSafe}</script>
      <script type="application/json" id="activity_json">${activityJsonSafe}</script>
      <script>
        (function () {
          function qs(sel) { return document.querySelector(sel); }
          function getClients() {
            var el = qs('#clients_json');
            if (!el) return [];
            try { return JSON.parse(el.textContent || '[]'); } catch { return []; }
          }

          function applyClientFilter() {
            var toggle = qs('#show_disabled_apps');
            var sel = qs('#client_select');
            if (!sel || !toggle) return;

            var showDisabled = Boolean(toggle.checked);
            var selected = sel.value;
            Array.from(sel.options).forEach(function (opt) {
              try {
                if (!opt || !opt.getAttribute) return;
                var enabled = opt.getAttribute('data-enabled');
                if (enabled === null) return;
                var isSelected = opt.value === selected;
                opt.hidden = !showDisabled && enabled === '0' && !isSelected;
              } catch (e) {}
            });
          }

          function base64Url(bytes) {
            var arr = new Uint8Array(bytes);
            window.crypto.getRandomValues(arr);
            var s = btoa(String.fromCharCode.apply(null, Array.from(arr)));
            return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
          }

          function setStateIfEmpty() {
            var state = qs('#state_input');
            if (!state) return;
            if (!state.value) state.value = base64Url(18);
          }

          function populateRedirects() {
            var clients = getClients();
            var clientSel = qs('#client_select');
            var redirectSel = qs('#redirect_select');
            if (!clientSel || !redirectSel) return;

            var selected = clientSel.value;
            var client = clients.find(function (c) { return c.client_id === selected; });
            var current = '${selectedRedirect}'.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");

            redirectSel.innerHTML = '';
            var opt0 = document.createElement('option');
            opt0.value = '';
            opt0.disabled = true;
            opt0.textContent = 'Select a redirect URL…';
            redirectSel.appendChild(opt0);

            if (client && Array.isArray(client.redirect_uris)) {
              client.redirect_uris.forEach(function (u) {
                var opt = document.createElement('option');
                opt.value = u;
                opt.textContent = u;
                if (u === current) opt.selected = true;
                redirectSel.appendChild(opt);
              });
            }
            if (!redirectSel.value) opt0.selected = true;
          }

          function wireCustomRedirectToggle() {
            var t = qs('#redirect_custom_toggle');
            var sel = qs('#redirect_select');
            var custom = qs('#redirect_custom');
            if (!t || !sel || !custom) return;

            function apply() {
              if (t.checked) {
                sel.style.display = 'none';
                sel.removeAttribute('name');
                custom.style.display = '';
                custom.setAttribute('name', 'redirect_uri');
                custom.required = true;
              } else {
                custom.style.display = 'none';
                custom.removeAttribute('name');
                custom.required = false;
                sel.style.display = '';
                sel.setAttribute('name', 'redirect_uri');
                sel.required = true;
              }
            }
            t.addEventListener('change', apply);
            apply();
          }

          function parseCallbackUrl() {
            var inp = qs('#callback_url');
            var code = qs('#code_extracted');
            var state = qs('#state_extracted');
            var warn = qs('#state_warning');
            var expectedState = qs('#state_input');
            if (!inp || !code || !state || !warn) return;

            function update() {
              warn.style.display = 'none';
              var v = (inp.value || '').trim();
              if (!v) return;
              try {
                var u = new URL(v);
                var c = u.searchParams.get('code') || '';
                var s = u.searchParams.get('state') || '';
                if (c) code.value = c;
                if (s) state.value = s;
                if (expectedState && expectedState.value && s && expectedState.value !== s) {
                  warn.style.display = '';
                }
              } catch (e) {
                // ignore
              }
              syncStep3();
            }

            inp.addEventListener('input', update);
            update();
          }

          function syncStep3() {
            var code = qs('#code_extracted');
            var redirectSel = qs('#redirect_select');
            var redirectCustom = qs('#redirect_custom');
            var redirectToggle = qs('#redirect_custom_toggle');
            var clientSel = qs('#client_select');
            var codeHidden = qs('#code_hidden');
            var redirectHidden = qs('#redirect_hidden');
            var clientHidden = qs('#client_hidden');
            var btn = qs('#verify_btn');
            var help = qs('#verify_help');
            if (!codeHidden || !redirectHidden || !clientHidden || !btn || !help || !code || !clientSel) return;

            var redirect = '';
            if (redirectToggle && redirectToggle.checked && redirectCustom) redirect = redirectCustom.value || '';
            else if (redirectSel) redirect = redirectSel.value || '';

            codeHidden.value = code.value || '';
            redirectHidden.value = redirect || '';
            clientHidden.value = clientSel.value || '';

            var manual = qs('#manual_mode');
            var consoleEl = document.querySelector('.console');
            var allow = (manual && manual.checked) || (consoleEl && consoleEl.getAttribute('data-step1-ok') === '1');
            var ok = allow && Boolean(codeHidden.value) && Boolean(redirectHidden.value) && Boolean(clientHidden.value);
            btn.disabled = !ok;
            help.textContent = ok ? 'Ready to verify.' : (allow ? 'Paste a callback URL (code) and pick callback URL.' : 'Run step 1 first (or enable manual mode).');

            // Finish step input gating
            var finish = qs('#finish_step');
            if (finish) {
              var controls = finish.querySelectorAll('input,button');
              controls.forEach(function (el) {
                try {
                  if (el && el.id === 'verify_btn') return;
                  el.disabled = !allow;
                } catch (e) {}
              });
            }

            var auto = qs('#auto_verify');
            var form = qs('#finish_form');
            if (ok && auto && auto.checked && form && typeof form.requestSubmit === 'function') {
              try {
                if (!form.getAttribute('data-submitting')) {
                  form.setAttribute('data-submitting', '1');
                  setTimeout(function () { try { form.requestSubmit(); } catch (e) {} }, 50);
                }
              } catch (e) {}
            }
          }

          function wireStepperEnablement() {
            var manual = qs('#manual_mode');
            if (manual) manual.addEventListener('change', syncStep3);
            var code = qs('#code_extracted');
            if (code) code.addEventListener('input', syncStep3);
            var redirectSel = qs('#redirect_select');
            if (redirectSel) redirectSel.addEventListener('change', syncStep3);
            var redirectCustom = qs('#redirect_custom');
            if (redirectCustom) redirectCustom.addEventListener('input', syncStep3);
            var clientSel = qs('#client_select');
            if (clientSel) clientSel.addEventListener('change', function () { applyClientFilter(); populateRedirects(); syncStep3(); });
          }

          function wireShowDisabledApps() {
            var t = qs('#show_disabled_apps');
            if (!t) return;
            t.addEventListener('change', function () { applyClientFilter(); populateRedirects(); syncStep3(); });
          }

          function wirePasteClipboard() {
            var b = qs('#paste_clipboard');
            var inp = qs('#callback_url');
            if (!b || !inp) return;
            b.addEventListener('click', function () {
              if (!navigator.clipboard || !navigator.clipboard.readText) {
                try { inp.focus(); } catch (e) {}
                return;
              }
              navigator.clipboard.readText().then(function (t) {
                inp.value = (t || '').trim();
                inp.dispatchEvent(new Event('input', { bubbles: true }));
              }).catch(function () {
                try { inp.focus(); } catch (e) {}
              });
            });
          }

          function wireRegenState() {
            var b = qs('#regen_state');
            var state = qs('#state_input');
            if (!b || !state) return;
            b.addEventListener('click', function () {
              state.value = base64Url(18);
            });
          }

          function wireCopyButtons() {
            document.addEventListener('click', function (e) {
              var t = e.target;
              if (!(t instanceof HTMLElement)) return;
              var v = t.getAttribute('data-copy');
              if (!v) return;
              navigator.clipboard.writeText(v).then(function () {
                t.textContent = 'Copied';
                setTimeout(function () { t.textContent = 'Copy'; }, 900);
              }).catch(function () {});
            });
          }

          function wireActivityClicks() {
            document.addEventListener('click', function (e) {
              var t = e.target;
              if (!(t instanceof HTMLElement)) return;
              var btn = t.closest('button[data-activity]');
              if (!btn) return;
              try {
                var ev = JSON.parse(btn.getAttribute('data-activity') || '{}');
                if (ev.client_id) { var cs = qs('#client_select'); if (cs) { cs.value = ev.client_id; populateRedirects(); } }
                if (ev.email) { var em = qs('#user_email'); if (em) em.value = ev.email; }
                if (ev.redirect_uri) { var rs = qs('#redirect_select'); if (rs) rs.value = ev.redirect_uri; }
                if (ev.state) { var st = qs('#state_input'); if (st) st.value = ev.state; }

                // Populate output panel with event payload (info)
                var outLast = qs('#out_last_action');
                if (outLast) outLast.textContent = 'activity_loaded';
                var outHttp = qs('#out_http');
                if (outHttp) outHttp.textContent = '—';
                var uc = qs('#out_user_created');
                if (uc) uc.textContent = '—';
                var oc = qs('#out_client_code');
                if (oc) oc.textContent = ev.client_id || '—';
                var ocb = qs('#out_client_copy');
                if (ocb) ocb.setAttribute('data-copy', ev.client_id || '');
                var orc = qs('#out_redirect_code');
                if (orc) orc.textContent = ev.redirect_uri || '—';
                var orcb = qs('#out_redirect_copy');
                if (orcb) orcb.setAttribute('data-copy', ev.redirect_uri || '');
                var ots = qs('#out_ts');
                if (ots) ots.textContent = ev.ts || new Date().toISOString();
                var req = qs('#out_reqid_code');
                if (req) req.textContent = '—';

                var jsonEl = qs('#out_json');
                if (jsonEl) {
                  try { jsonEl.textContent = JSON.stringify(ev, null, 2); } catch (e2) { jsonEl.textContent = String(ev); }
                }
                var rawEl = qs('#out_raw');
                if (rawEl) rawEl.textContent = JSON.stringify(ev);

                syncStep3();
              } catch (err) {}
            });
          }

          function wireAppClicks() {
            document.addEventListener('click', function (e) {
              var t = e.target;
              if (!(t instanceof HTMLElement)) return;
              var btn = t.closest('button[data-app]');
              if (!btn) return;
              var appId = btn.getAttribute('data-app') || '';
              if (!appId) return;
              var cs = qs('#client_select');
              if (cs) {
                cs.value = appId;
                applyClientFilter();
                populateRedirects();
              }

              try {
                var lbl = qs('#apps_selected_label');
                if (lbl) lbl.textContent = appId;
                var els = document.querySelectorAll('input.appsClientId');
                els.forEach(function (el) { try { el.value = appId; } catch (e2) {} });
              } catch (err2) {}

              var outLast = qs('#out_last_action');
              if (outLast) outLast.textContent = 'app_loaded';
              var oc = qs('#out_client_code');
              if (oc) oc.textContent = appId;
              var ocb = qs('#out_client_copy');
              if (ocb) ocb.setAttribute('data-copy', appId);
              syncStep3();
            });
          }

          function wireTestModal() {
            var back = qs('#test_modal_back');
            var openBtn = qs('#open_test_modal');
            var closeBtn = qs('#close_test_modal');
            if (!back || !openBtn || !closeBtn) return;

            function open() {
              back.setAttribute('data-open', '1');
              back.setAttribute('aria-hidden', 'false');
              try {
                var first = qs('#client_select') || qs('#user_email') || qs('#callback_url');
                if (first && first.focus) first.focus();
              } catch (e) {}
            }
            function close() {
              back.setAttribute('data-open', '0');
              back.setAttribute('aria-hidden', 'true');
            }

            openBtn.addEventListener('click', function () { open(); });
            closeBtn.addEventListener('click', function () { close(); });
            back.addEventListener('click', function (e) {
              try { if (e.target === back) close(); } catch (err) {}
            });
            document.addEventListener('keydown', function (e) {
              try {
                if (e.key === 'Escape' && back.getAttribute('data-open') === '1') close();
              } catch (err) {}
            });
          }

          setStateIfEmpty();
          applyClientFilter();
          populateRedirects();
          wireCustomRedirectToggle();
          wireShowDisabledApps();
          wireRegenState();
          parseCallbackUrl();
          wireStepperEnablement();
          wirePasteClipboard();
          wireCopyButtons();
          wireActivityClicks();
          wireAppClicks();
          wireTestModal();
          syncStep3();
        })();
      </script>`
    , { htmlClass: 'consoleMode', bodyClass: 'consoleMode' });
  }

  async function loadConsoleData(params: {
    q: string;
    usersPage: number;
    usersPageSize: number;
    tab: 'users' | 'activity' | 'apps';
    clientsQuery: string;
    activityClientId: string;
    activityEmailPrefix: string;
  }): Promise<{
    totalUsers: number;
    usersTotalMatching: number;
    usersRowsHtml: string;
    clients: Array<{ client_id: string; redirect_uris: string[]; is_enabled: boolean }>;
    activity: Array<{
      kind: string;
      ts: string;
      client_id: string;
      email: string;
      redirect_uri: string;
      state: string;
      lr_id?: string;
      ac_id?: string;
    }>;
  }> {
    const q = params.q.trim().toLowerCase();
    const usersPage = Number.isFinite(params.usersPage) && params.usersPage > 0 ? params.usersPage : 1;
    const usersPageSize = Number.isFinite(params.usersPageSize) && params.usersPageSize > 0 ? params.usersPageSize : 50;
    const offset = (usersPage - 1) * usersPageSize;

    const usersTotalMatchingRes =
      q.length > 0
        ? await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE email_normalized LIKE $1', [`${q}%`])
        : await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const usersTotalMatching = (usersTotalMatchingRes.rows[0] as { count: number }).count;

    const users =
      q.length > 0
        ? await pool.query(
            `SELECT u.id, u.email_normalized, u.created_at, a.last_login_at, a.last_client_id
             FROM users u
             LEFT JOIN LATERAL (
               SELECT ac.used_at AS last_login_at, ac.client_id AS last_client_id
               FROM auth_codes ac
               WHERE ac.user_id = u.id AND ac.used_at IS NOT NULL
               ORDER BY ac.used_at DESC
               LIMIT 1
             ) a ON true
             WHERE u.email_normalized LIKE $1
             ORDER BY u.created_at DESC
             LIMIT $2 OFFSET $3`,
            [`${q}%`, usersPageSize, offset]
          )
        : await pool.query(
            `SELECT u.id, u.email_normalized, u.created_at, a.last_login_at, a.last_client_id
             FROM users u
             LEFT JOIN LATERAL (
               SELECT ac.used_at AS last_login_at, ac.client_id AS last_client_id
               FROM auth_codes ac
               WHERE ac.user_id = u.id AND ac.used_at IS NOT NULL
               ORDER BY ac.used_at DESC
               LIMIT 1
             ) a ON true
             ORDER BY u.created_at DESC
             LIMIT $1 OFFSET $2`,
            [usersPageSize, offset]
          );
    const usersRowsHtml = users.rows
      .map((r: any) => {
        const id = String(r.id);
        const email = String(r.email_normalized);
        const created = new Date(r.created_at).toISOString();
        const lastLogin = r.last_login_at ? new Date(r.last_login_at).toISOString() : '';
        const lastClient = r.last_client_id ? String(r.last_client_id) : '';
        return `<tr>
          <td title="Signed up: ${htmlEscape(created)}"><a href="/admin/users/${encodeURIComponent(id)}"><code>${htmlEscape(
            email
          )}</code></a></td>
          <td class="muted">${htmlEscape(lastLogin || '—')}</td>
          <td class="muted"><code>${htmlEscape(lastClient || '—')}</code></td>
        </tr>`;
      })
      .join('');

    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const totalUsers = (countRes.rows[0] as { count: number }).count;

    const clientsRes = await pool.query(
      `SELECT client_id, redirect_uris, is_enabled, client_secret_plain
       FROM clients
       ORDER BY client_id ASC`
    );
    const clients = clientsRes.rows.map((r: any) => ({
      client_id: String(r.client_id),
      redirect_uris: Array.isArray(r.redirect_uris) ? (r.redirect_uris as string[]) : [],
      is_enabled: Boolean(r.is_enabled),
      client_secret_plain: r.client_secret_plain === null || r.client_secret_plain === undefined ? null : String(r.client_secret_plain)
    }));

    const activityRes = await pool.query(
      `SELECT kind, ts, client_id, email, redirect_uri, state, lr_id, ac_id
       FROM (
         SELECT 'sent'::text AS kind, lr.created_at AS ts, lr.client_id, u.email_normalized AS email, lr.redirect_uri, lr.state, lr.id AS lr_id, NULL::uuid AS ac_id
         FROM login_requests lr
         JOIN users u ON u.id = lr.user_id
         UNION ALL
         SELECT 'clicked'::text AS kind, lr.used_at AS ts, lr.client_id, u.email_normalized AS email, lr.redirect_uri, lr.state, lr.id AS lr_id, NULL::uuid AS ac_id
         FROM login_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.used_at IS NOT NULL
         UNION ALL
         SELECT 'exchanged'::text AS kind, ac.used_at AS ts, ac.client_id, u.email_normalized AS email, ac.redirect_uri, ''::text AS state, NULL::uuid AS lr_id, ac.id AS ac_id
         FROM auth_codes ac
         JOIN users u ON u.id = ac.user_id
         WHERE ac.used_at IS NOT NULL
       ) x
       WHERE ts IS NOT NULL
         AND ($1 = '' OR client_id = $1)
         AND ($2 = '' OR email LIKE ($2 || '%'))
       ORDER BY ts DESC
       LIMIT 40`,
      [params.activityClientId, params.activityEmailPrefix]
    );
    const activity = activityRes.rows.map((r: any) => ({
      kind: String(r.kind),
      ts: new Date(r.ts).toISOString(),
      client_id: String(r.client_id),
      email: String(r.email),
      redirect_uri: String(r.redirect_uri ?? ''),
      state: String(r.state ?? ''),
      lr_id: r.lr_id ? String(r.lr_id) : undefined,
      ac_id: r.ac_id ? String(r.ac_id) : undefined
    }));

    return { totalUsers, usersTotalMatching, usersRowsHtml, clients, activity };
  }

  // Login UI
  app.get('/admin/login', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (session) return reply.redirect('/admin/', 302);

    const body = page(
      'Passhroom Admin Login',
      `<div class="top">
        <div class="brand">
          <img src="/assets/poison-shroom.png" alt="" />
          <h1>Passhroom</h1>
          <span class="pill">admin</span>
        </div>
        <span class="tag">Email link sign-in</span>
      </div>
      <div class="panel">
        <div class="panelTitle">
          <h2>Sign in</h2>
          <span class="pill">admin-only</span>
        </div>
        <p class="muted" style="margin-top:0">We'll email you a one-time sign-in link.</p>
        <form method="post" action="/admin/login/start" class="stack" style="margin-top:12px">
          <div class="field">
            <label for="admin_email">Admin email</label>
            <div class="help"><span class="hintIcon">ⓘ</span>Must match the allowlist in the server config.</div>
            <input id="admin_email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required />
          </div>
          <div class="btnRow">
            <button class="btn" type="submit">Email sign-in link</button>
            <span class="muted">Expires in ${env.admin.loginTtlMinutes} minutes.</span>
          </div>
        </form>
      </div>`
    );
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(body);
  });

  app.post('/admin/login/start', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const body = (req.body ?? {}) as { email?: string };
    const email = normalizeEmail(body.email ?? '');
    if (!email || !ADMIN_EMAILS.has(email)) {
      return reply.code(403).send('Forbidden');
    }

    const magicToken = randomToken(32);
    const magicHash = sha256Base64Url(magicToken);
    const expiresAt = new Date(Date.now() + env.admin.loginTtlMinutes * 60 * 1000);

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
    await pool.query(
      `INSERT INTO admin_login_requests
         (email_normalized, magic_token_hash, expires_at, attempts, ip, user_agent)
       VALUES
         ($1, $2, $3, 0, $4, $5)`,
      [email, magicHash, expiresAt, ip, req.headers['user-agent'] ?? null]
    );

    const magicLinkUrl = `${env.publicBaseUrl}/admin/magic?t=${encodeURIComponent(magicToken)}`;
    const sendResult = await sendMagicLinkEmail({
      toEmail: email,
      magicLinkUrl,
      appName: 'Passhroom Admin',
      expiresMinutes: env.admin.loginTtlMinutes
    });

    req.log.info(
      {
        event: 'email_sent',
        kind: 'admin_magic_link',
        email: '[admin]',
        message_id: sendResult.messageId,
        accepted_count: sendResult.accepted.length,
        rejected_count: sendResult.rejected.length
      },
      'SMTP send attempted'
    );

    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(
      page(
        'Admin link sent',
        `<div class="top">
          <div class="brand"><img src="/assets/poison-shroom.png" alt="" /><h1>Passhroom</h1><span class="pill">admin</span></div>
          <a href="/admin/login">Back</a>
        </div>
        <div class="panel">
          <div class="panelTitle">
            <h2>Email sent</h2>
            <span class="pill">check inbox</span>
          </div>
          <p style="margin-top:0">Sent a sign-in link to <code>${htmlEscape(email)}</code>.</p>
          <p class="muted" style="margin-top:8px"><span class="hintIcon">ⓘ</span>Open the email and click the link to sign in. The link is single-use and expires after a short time.</p>
        </div>`
      )
    );
  });

  // Magic-link landing for admin
  app.get('/admin/magic', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const t = (req.query as { t?: string }).t;
    if (!t) return reply.code(400).send('Missing token');

    const tokenHash = sha256Base64Url(t);
    const found = await pool.query(
      `SELECT id, email_normalized, expires_at, used_at, attempts
       FROM admin_login_requests
       WHERE magic_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );
    if (found.rowCount !== 1) return reply.code(400).send('Invalid or expired token');
    const row = found.rows[0] as {
      id: string;
      email_normalized: string;
      expires_at: Date;
      used_at: Date | null;
      attempts: number;
    };

    await pool.query('UPDATE admin_login_requests SET attempts = attempts + 1 WHERE id = $1', [row.id]);

    if (row.used_at) return reply.code(400).send('Token already used');
    if (row.expires_at.getTime() <= Date.now()) return reply.code(400).send('Token expired');
    if (row.attempts >= env.maxMagicAttempts) return reply.code(400).send('Too many attempts');
    if (!ADMIN_EMAILS.has(row.email_normalized)) return reply.code(403).send('Forbidden');

    await pool.query('UPDATE admin_login_requests SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [row.id]);

    const sessionToken = randomToken(32);
    const sessionHash = sha256Base64Url(sessionToken);
    const expiresAt = new Date(Date.now() + env.admin.sessionTtlHours * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO admin_sessions (email_normalized, session_token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [row.email_normalized, sessionHash, expiresAt]
    );

    reply.setCookie(ADMIN_COOKIE_NAME, sessionToken, {
      path: '/admin',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production'
    });

    return reply.redirect('/admin/', 302);
  });

  app.get('/admin/logout', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const tokenRaw = req.cookies?.[ADMIN_COOKIE_NAME] as string | undefined;
    if (tokenRaw) {
      const tokenHash = sha256Base64Url(tokenRaw);
      await pool.query('DELETE FROM admin_sessions WHERE session_token_hash = $1', [tokenHash]);
    }
    reply.clearCookie(ADMIN_COOKIE_NAME, { path: '/admin' });
    return reply.redirect('/admin/login', 302);
  });

  // Convenience: browsers often hit /admin (no trailing slash), but our console lives at /admin/.
  app.get('/admin', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const suffix = req.url.startsWith('/admin') ? req.url.slice('/admin'.length) : '';
    return reply.redirect(`/admin/${suffix}`, 302);
  });

  app.get('/admin/', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const q = String((req.query as any)?.q ?? '').trim().toLowerCase();
    const cq = String((req.query as any)?.cq ?? '').trim();
    const tabRaw = String((req.query as any)?.tab ?? 'users');
    const tab = tabRaw === 'activity' ? 'activity' : tabRaw === 'apps' ? 'apps' : 'users';

    const pageRaw = Number.parseInt(String((req.query as any)?.page ?? '1'), 10);
    const usersPage = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const usersPageSize = 50;

    const activityClientId = String((req.query as any)?.ac ?? '').trim();
    const activityEmailPrefix = String((req.query as any)?.ae ?? '').trim().toLowerCase();

    const usersTotalMatchingRes =
      q.length > 0
        ? await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE email_normalized LIKE $1', [`${q}%`])
        : await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const usersTotalMatching = (usersTotalMatchingRes.rows[0] as { count: number }).count;

    const offset = (usersPage - 1) * usersPageSize;

    const users =
      q.length > 0
        ? await pool.query(
            `SELECT u.id, u.email_normalized, u.created_at, a.last_login_at, a.last_client_id
             FROM users u
             LEFT JOIN LATERAL (
               SELECT ac.used_at AS last_login_at, ac.client_id AS last_client_id
               FROM auth_codes ac
               WHERE ac.user_id = u.id AND ac.used_at IS NOT NULL
               ORDER BY ac.used_at DESC
               LIMIT 1
             ) a ON true
             WHERE u.email_normalized LIKE $1
             ORDER BY u.created_at DESC
             LIMIT $2 OFFSET $3`,
            [`${q}%`, usersPageSize, offset]
          )
        : await pool.query(
            `SELECT u.id, u.email_normalized, u.created_at, a.last_login_at, a.last_client_id
             FROM users u
             LEFT JOIN LATERAL (
               SELECT ac.used_at AS last_login_at, ac.client_id AS last_client_id
               FROM auth_codes ac
               WHERE ac.user_id = u.id AND ac.used_at IS NOT NULL
               ORDER BY ac.used_at DESC
               LIMIT 1
             ) a ON true
             ORDER BY u.created_at DESC
             LIMIT $1 OFFSET $2`,
            [usersPageSize, offset]
          );
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const totalUsers = (countRes.rows[0] as { count: number }).count;

    const clientsRes = await pool.query(
      `SELECT client_id, redirect_uris, is_enabled
       FROM clients
       ORDER BY client_id ASC`
    );
    const clients = clientsRes.rows.map((r: any) => ({
      client_id: String(r.client_id),
      redirect_uris: Array.isArray(r.redirect_uris) ? (r.redirect_uris as string[]) : [],
      is_enabled: Boolean(r.is_enabled)
    }));

    const activityRes = await pool.query(
      `SELECT kind, ts, client_id, email, redirect_uri, state, lr_id, ac_id
       FROM (
         SELECT 'sent'::text AS kind, lr.created_at AS ts, lr.client_id, u.email_normalized AS email, lr.redirect_uri, lr.state, lr.id AS lr_id, NULL::uuid AS ac_id
         FROM login_requests lr
         JOIN users u ON u.id = lr.user_id
         UNION ALL
         SELECT 'clicked'::text AS kind, lr.used_at AS ts, lr.client_id, u.email_normalized AS email, lr.redirect_uri, lr.state, lr.id AS lr_id, NULL::uuid AS ac_id
         FROM login_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.used_at IS NOT NULL
         UNION ALL
         SELECT 'exchanged'::text AS kind, ac.used_at AS ts, ac.client_id, u.email_normalized AS email, ac.redirect_uri, ''::text AS state, NULL::uuid AS lr_id, ac.id AS ac_id
         FROM auth_codes ac
         JOIN users u ON u.id = ac.user_id
         WHERE ac.used_at IS NOT NULL
       ) x
       WHERE ts IS NOT NULL
         AND ($1 = '' OR client_id = $1)
         AND ($2 = '' OR email LIKE ($2 || '%'))
       ORDER BY ts DESC
       LIMIT 40`,
      [activityClientId, activityEmailPrefix]
    );
    const activity = activityRes.rows.map((r: any) => ({
      kind: String(r.kind),
      ts: new Date(r.ts).toISOString(),
      client_id: String(r.client_id),
      email: String(r.email),
      redirect_uri: String(r.redirect_uri ?? ''),
      state: String(r.state ?? ''),
      lr_id: r.lr_id ? String(r.lr_id) : undefined,
      ac_id: r.ac_id ? String(r.ac_id) : undefined
    }));

    const rowsHtml = users.rows
      .map((r: any) => {
        const id = String(r.id);
        const email = String(r.email_normalized);
        const created = new Date(r.created_at).toISOString();
        const lastLogin = r.last_login_at ? new Date(r.last_login_at).toISOString() : '';
        const lastClient = r.last_client_id ? String(r.last_client_id) : '';
        return `<tr>
          <td title="Signed up: ${htmlEscape(created)}"><a href="/admin/users/${encodeURIComponent(id)}"><code>${htmlEscape(email)}</code></a></td>
          <td class="muted">${htmlEscape(lastLogin || '—')}</td>
          <td class="muted"><code>${htmlEscape(lastClient || '—')}</code></td>
        </tr>`;
      })
      .join('');

    const body = renderConsole({
      sessionEmail: session.email_normalized,
      totalUsers,
      tab,
      usersRowsHtml: rowsHtml,
      usersQuery: q,
      usersPage,
      usersPageSize,
      usersTotalMatching,
      clients,
      clientsQuery: cq,
      activity,
      activityClientId,
      activityEmailPrefix,
      form: {},
      output: undefined
    });

    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(body);
  });

  app.get('/admin/users.csv', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.code(401).send('Unauthorized');

    const q = String((req.query as any)?.q ?? '').trim().toLowerCase();
    const rows =
      q.length > 0
        ? await pool.query(
            `SELECT u.email_normalized, u.created_at, a.last_login_at, a.last_client_id
             FROM users u
             LEFT JOIN LATERAL (
               SELECT ac.used_at AS last_login_at, ac.client_id AS last_client_id
               FROM auth_codes ac
               WHERE ac.user_id = u.id AND ac.used_at IS NOT NULL
               ORDER BY ac.used_at DESC
               LIMIT 1
             ) a ON true
             WHERE u.email_normalized LIKE $1
             ORDER BY u.created_at DESC
             LIMIT 5000`,
            [`${q}%`]
          )
        : await pool.query(
            `SELECT u.email_normalized, u.created_at, a.last_login_at, a.last_client_id
             FROM users u
             LEFT JOIN LATERAL (
               SELECT ac.used_at AS last_login_at, ac.client_id AS last_client_id
               FROM auth_codes ac
               WHERE ac.user_id = u.id AND ac.used_at IS NOT NULL
               ORDER BY ac.used_at DESC
               LIMIT 1
             ) a ON true
             ORDER BY u.created_at DESC
             LIMIT 5000`
          );

    function csvEscape(v: string) {
      const s = v.replaceAll('"', '""');
      return `"${s}"`;
    }

    const header = ['email', 'created_at', 'last_login_at', 'last_app'].join(',');
    const lines = rows.rows.map((r: any) => {
      const email = String(r.email_normalized ?? '');
      const createdAt = r.created_at ? new Date(r.created_at).toISOString() : '';
      const lastLogin = r.last_login_at ? new Date(r.last_login_at).toISOString() : '';
      const lastApp = String(r.last_client_id ?? '');
      return [csvEscape(email), csvEscape(createdAt), csvEscape(lastLogin), csvEscape(lastApp)].join(',');
    });
    const csv = [header, ...lines].join('\n');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="users.csv"');
    return reply.send(csv);
  });

  app.get('/admin/users/:id', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const id = String((req.params as any).id ?? '');
    const userRes = await pool.query('SELECT id, email_normalized, created_at FROM users WHERE id = $1', [id]);
    if (userRes.rowCount !== 1) return reply.code(404).send('User not found');
    const user = userRes.rows[0] as { id: string; email_normalized: string; created_at: Date };

    const lrRes = await pool.query(
      `SELECT id, client_id, redirect_uri, state, ip, user_agent, created_at, used_at, expires_at, attempts
       FROM login_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [id]
    );
    const acRes = await pool.query(
      `SELECT id, client_id, redirect_uri, created_at, used_at, expires_at
       FROM auth_codes
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [id]
    );

    const lrRows = lrRes.rows
      .map((r: any) => {
        const used = r.used_at ? new Date(r.used_at).toISOString() : '—';
        const created = r.created_at ? new Date(r.created_at).toISOString() : '—';
        const exp = r.expires_at ? new Date(r.expires_at).toISOString() : '—';
        return `<tr>
          <td><code>${htmlEscape(String(r.client_id))}</code></td>
          <td class="muted">${htmlEscape(created)}</td>
          <td class="muted">${htmlEscape(used)}</td>
          <td class="muted">${htmlEscape(exp)}</td>
          <td class="muted" title="${htmlEscape(String(r.redirect_uri ?? ''))}">${htmlEscape(String(r.redirect_uri ?? ''))}</td>
          <td class="muted" title="${htmlEscape(String(r.ip ?? ''))}">${htmlEscape(String(r.ip ?? ''))}</td>
        </tr>`;
      })
      .join('');
    const acRows = acRes.rows
      .map((r: any) => {
        const used = r.used_at ? new Date(r.used_at).toISOString() : '—';
        const created = r.created_at ? new Date(r.created_at).toISOString() : '—';
        const exp = r.expires_at ? new Date(r.expires_at).toISOString() : '—';
        return `<tr>
          <td><code>${htmlEscape(String(r.client_id))}</code></td>
          <td class="muted">${htmlEscape(created)}</td>
          <td class="muted">${htmlEscape(used)}</td>
          <td class="muted">${htmlEscape(exp)}</td>
          <td class="muted" title="${htmlEscape(String(r.redirect_uri ?? ''))}">${htmlEscape(String(r.redirect_uri ?? ''))}</td>
        </tr>`;
      })
      .join('');

    const body = page(
      'User details',
      `<div class="top">
        <div class="brand"><img src="/assets/poison-shroom.png" alt="" /><h1>Passhroom</h1><span class="pill">admin</span></div>
        <a href="/admin/?tab=users">Back</a>
      </div>
      <div class="panel">
        <div class="panelTitle"><h2>User</h2><span class="pill">details</span></div>
        <div class="kv" style="margin-top:10px">
          <div class="k">Email</div><div class="v"><code>${htmlEscape(user.email_normalized)}</code></div>
          <div class="k">User ID</div><div class="v"><code>${htmlEscape(user.id)}</code></div>
          <div class="k">Created</div><div class="v">${htmlEscape(new Date(user.created_at).toISOString())}</div>
        </div>
      </div>

      <div class="panel" style="margin-top:12px">
        <div class="panelTitle"><h2>Login requests</h2><span class="pill">latest 25</span></div>
        <table class="denseTable" style="margin-top:10px">
          <thead><tr><th>App</th><th>Created</th><th>Clicked</th><th>Expires</th><th>Callback URL</th><th>IP</th></tr></thead>
          <tbody>${lrRows || '<tr><td colspan="6" class="muted">No login requests yet.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="panel" style="margin-top:12px">
        <div class="panelTitle"><h2>Auth codes</h2><span class="pill">latest 25</span></div>
        <table class="denseTable" style="margin-top:10px">
          <thead><tr><th>App</th><th>Created</th><th>Used</th><th>Expires</th><th>Callback URL</th></tr></thead>
          <tbody>${acRows || '<tr><td colspan="5" class="muted">No auth codes yet.</td></tr>'}</tbody>
        </table>
      </div>`
    );
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(body);
  });

  app.post('/admin/users/create', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as { email?: string };
    const email = normalizeEmail(body.email ?? '');
    if (!email) return reply.redirect('/admin/?tab=users', 302);

    const existing = await pool.query('SELECT id FROM users WHERE email_normalized = $1', [email]);
    if (existing.rowCount === 0) {
      await pool.query('INSERT INTO users (email_normalized) VALUES ($1)', [email]);
      req.log.info({ event: 'admin_user_created', admin: session.email_normalized, email: '[redacted]' });
    }
    return reply.redirect(`/admin/?tab=users&q=${encodeURIComponent(email.split('@')[0] ?? '')}`, 302);
  });

  async function sendConsoleFromAction(params: {
    sessionEmail: string;
    tab: 'users' | 'activity' | 'apps';
    q: string;
    usersPage: number;
    usersPageSize: number;
    clientsQuery: string;
    activityClientId: string;
    activityEmailPrefix: string;
    form: any;
    output: any;
  }, reply: any) {
    const data = await loadConsoleData({
      q: params.q,
      usersPage: params.usersPage,
      usersPageSize: params.usersPageSize,
      tab: params.tab,
      clientsQuery: params.clientsQuery,
      activityClientId: params.activityClientId,
      activityEmailPrefix: params.activityEmailPrefix
    });

    const html = renderConsole({
      sessionEmail: params.sessionEmail,
      totalUsers: data.totalUsers,
      tab: params.tab,
      usersRowsHtml: data.usersRowsHtml,
      usersQuery: params.q,
      usersPage: params.usersPage,
      usersPageSize: params.usersPageSize,
      usersTotalMatching: data.usersTotalMatching,
      clients: data.clients,
      clientsQuery: params.clientsQuery,
      activity: data.activity,
      activityClientId: params.activityClientId,
      activityEmailPrefix: params.activityEmailPrefix,
      form: params.form,
      output: params.output
    });
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(html);
  }

  app.post('/admin/apps/create', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as { client_id?: string; redirect_uris?: string; is_enabled?: string };
    const clientId = String(body.client_id ?? '').trim();
    const enabled = String(body.is_enabled ?? 'true') !== 'false';
    const redirectsRaw = String(body.redirect_uris ?? '');
    const redirects = redirectsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    let httpStatus = 200;
    let responseJson: any = null;
    let responseText = '';
    let friendlyError: string | undefined;

    if (!clientId) {
      httpStatus = 400;
      friendlyError = 'App ID is required.';
    } else if (redirects.length === 0) {
      httpStatus = 400;
      friendlyError = 'At least one callback URL is required.';
    } else if (redirects.some((u) => !isValidHttpUrl(u))) {
      httpStatus = 400;
      friendlyError = 'All callback URLs must be valid http(s) URLs.';
    } else {
      const secret = randomToken(32);
      const secretHash = await argon2.hash(secret);
      try {
        await pool.query(
          `INSERT INTO clients (client_id, client_secret_hash, client_secret_plain, redirect_uris, allowed_origins, is_enabled)
           VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5)`,
          [clientId, secretHash, secret, JSON.stringify(redirects), enabled]
        );
        responseJson = { client_id: clientId, client_secret: secret, redirect_uris: redirects, is_enabled: enabled };
        responseText = JSON.stringify(responseJson);
        req.log.info({ event: 'admin_app_created', admin: session.email_normalized, client_id: clientId });
      } catch (e: any) {
        httpStatus = 400;
        friendlyError = 'Could not create app (it may already exist).';
        responseText = String(e?.message ?? e);
      }
    }

    return sendConsoleFromAction(
      {
        sessionEmail: session.email_normalized,
        tab: 'apps',
        q: '',
        usersPage: 1,
        usersPageSize: 50,
        clientsQuery: '',
        activityClientId: '',
        activityEmailPrefix: '',
        form: { client_id: clientId },
        output: {
          lastAction: 'create_app',
          httpStatus,
          requestId: randomToken(8),
          timestampIso: new Date().toISOString(),
          responseText,
          responseJson,
          friendlyError
        }
      },
      reply
    );
  });

  app.post('/admin/apps/rotate-secret', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as { client_id?: string };
    const clientId = String(body.client_id ?? '').trim();
    let httpStatus = 200;
    let responseJson: any = null;
    let responseText = '';
    let friendlyError: string | undefined;

    if (!clientId) {
      httpStatus = 400;
      friendlyError = 'App ID is required.';
    } else {
      const secret = randomToken(32);
      const secretHash = await argon2.hash(secret);
      const res = await pool.query('UPDATE clients SET client_secret_hash = $2, client_secret_plain = $3 WHERE client_id = $1', [clientId, secretHash, secret]);
      if (res.rowCount !== 1) {
        httpStatus = 404;
        friendlyError = 'App not found.';
      } else {
        responseJson = { client_id: clientId, client_secret: secret };
        responseText = JSON.stringify(responseJson);
        req.log.info({ event: 'admin_app_secret_rotated', admin: session.email_normalized, client_id: clientId });
      }
    }

    return sendConsoleFromAction(
      {
        sessionEmail: session.email_normalized,
        tab: 'apps',
        q: '',
        usersPage: 1,
        usersPageSize: 50,
        clientsQuery: '',
        activityClientId: '',
        activityEmailPrefix: '',
        form: { client_id: clientId },
        output: {
          lastAction: 'rotate_app_secret',
          httpStatus,
          requestId: randomToken(8),
          timestampIso: new Date().toISOString(),
          responseText,
          responseJson,
          friendlyError
        }
      },
      reply
    );
  });

  app.post('/admin/apps/set-enabled', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as { client_id?: string; is_enabled?: string };
    const clientId = String(body.client_id ?? '').trim();
    const enabled = String(body.is_enabled ?? 'true') !== 'false';
    let httpStatus = 200;
    let responseJson: any = null;
    let responseText = '';
    let friendlyError: string | undefined;

    if (!clientId) {
      httpStatus = 400;
      friendlyError = 'App ID is required.';
    } else {
      const res = await pool.query('UPDATE clients SET is_enabled = $2 WHERE client_id = $1', [clientId, enabled]);
      if (res.rowCount !== 1) {
        httpStatus = 404;
        friendlyError = 'App not found.';
      } else {
        responseJson = { client_id: clientId, is_enabled: enabled };
        responseText = JSON.stringify(responseJson);
        req.log.info({ event: 'admin_app_enabled_set', admin: session.email_normalized, client_id: clientId, is_enabled: enabled });
      }
    }

    return sendConsoleFromAction(
      {
        sessionEmail: session.email_normalized,
        tab: 'apps',
        q: '',
        usersPage: 1,
        usersPageSize: 50,
        clientsQuery: '',
        activityClientId: '',
        activityEmailPrefix: '',
        form: { client_id: clientId },
        output: {
          lastAction: enabled ? 'enable_app' : 'disable_app',
          httpStatus,
          requestId: randomToken(8),
          timestampIso: new Date().toISOString(),
          responseText,
          responseJson,
          friendlyError
        }
      },
      reply
    );
  });

  app.post('/admin/apps/add-callback', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as { client_id?: string; redirect_uri?: string };
    const clientId = String(body.client_id ?? '').trim();
    const uri = String(body.redirect_uri ?? '').trim();
    let httpStatus = 200;
    let responseJson: any = null;
    let responseText = '';
    let friendlyError: string | undefined;

    if (!clientId || !uri) {
      httpStatus = 400;
      friendlyError = 'App ID and callback URL are required.';
    } else if (!isValidHttpUrl(uri)) {
      httpStatus = 400;
      friendlyError = 'Callback URL must be a valid http(s) URL.';
    } else {
      const res = await pool.query(
        `UPDATE clients
         SET redirect_uris = (SELECT jsonb_agg(DISTINCT x) FROM (
           SELECT jsonb_array_elements_text(redirect_uris) AS x
           UNION ALL SELECT $2
         ) s)
         WHERE client_id = $1`,
        [clientId, uri]
      );
      if (res.rowCount !== 1) {
        httpStatus = 404;
        friendlyError = 'App not found.';
      } else {
        responseJson = { client_id: clientId, added: uri };
        responseText = JSON.stringify(responseJson);
        req.log.info({ event: 'admin_app_callback_added', admin: session.email_normalized, client_id: clientId, redirect_uri: uri });
      }
    }

    return sendConsoleFromAction(
      {
        sessionEmail: session.email_normalized,
        tab: 'apps',
        q: '',
        usersPage: 1,
        usersPageSize: 50,
        clientsQuery: '',
        activityClientId: '',
        activityEmailPrefix: '',
        form: { client_id: clientId },
        output: {
          lastAction: 'add_callback_url',
          httpStatus,
          requestId: randomToken(8),
          timestampIso: new Date().toISOString(),
          responseText,
          responseJson,
          friendlyError
        }
      },
      reply
    );
  });

  app.post('/admin/apps/remove-callback', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as { client_id?: string; redirect_uri?: string };
    const clientId = String(body.client_id ?? '').trim();
    const uri = String(body.redirect_uri ?? '').trim();
    let httpStatus = 200;
    let responseJson: any = null;
    let responseText = '';
    let friendlyError: string | undefined;

    if (!clientId || !uri) {
      httpStatus = 400;
      friendlyError = 'App ID and callback URL are required.';
    } else {
      const res = await pool.query(
        `UPDATE clients
         SET redirect_uris = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
           SELECT jsonb_array_elements_text(redirect_uris) AS x
         ) s WHERE x <> $2)
         WHERE client_id = $1`,
        [clientId, uri]
      );
      if (res.rowCount !== 1) {
        httpStatus = 404;
        friendlyError = 'App not found.';
      } else {
        responseJson = { client_id: clientId, removed: uri };
        responseText = JSON.stringify(responseJson);
        req.log.info({ event: 'admin_app_callback_removed', admin: session.email_normalized, client_id: clientId, redirect_uri: uri });
      }
    }

    return sendConsoleFromAction(
      {
        sessionEmail: session.email_normalized,
        tab: 'apps',
        q: '',
        usersPage: 1,
        usersPageSize: 50,
        clientsQuery: '',
        activityClientId: '',
        activityEmailPrefix: '',
        form: { client_id: clientId },
        output: {
          lastAction: 'remove_callback_url',
          httpStatus,
          requestId: randomToken(8),
          timestampIso: new Date().toISOString(),
          responseText,
          responseJson,
          friendlyError
        }
      },
      reply
    );
  });

  app.post('/admin/test/start', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as {
      client_id?: string;
      email?: string;
      redirect_uri?: string;
      state?: string;
      app_name?: string;
      app_return_to?: string;
    };

    const injectRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/start',
      headers: { 'content-type': 'application/json' },
      payload: {
        client_id: body.client_id ?? '',
        email: body.email ?? '',
        redirect_uri: body.redirect_uri ?? '',
        state: body.state ?? 'test',
        app_name: body.app_name,
        app_return_to: body.app_return_to
      }
    });

    const usersPage = 1;
    const usersPageSize = 50;
    const usersQuery = '';
    const clientsQuery = '';
    const activityClientId = '';
    const activityEmailPrefix = '';

    const data = await loadConsoleData({
      q: usersQuery,
      usersPage,
      usersPageSize,
      tab: 'users',
      clientsQuery,
      activityClientId,
      activityEmailPrefix
    });

    const responseJson = parseJsonSafe(injectRes.body || '');
    const retryAfterSecondsRaw = (injectRes.headers?.['retry-after'] as any) ?? (injectRes.headers?.['Retry-After'] as any);
    const retryAfterSeconds = retryAfterSecondsRaw ? Number.parseInt(String(retryAfterSecondsRaw), 10) : undefined;

    const output = {
      lastAction: 'send_magic_link',
      httpStatus: injectRes.statusCode,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds as any) ? retryAfterSeconds : undefined,
      userCreated: typeof responseJson?.user_created === 'boolean' ? (responseJson.user_created as boolean) : undefined,
      client_id: body.client_id ?? '',
      redirect_uri: body.redirect_uri ?? '',
      email: body.email ?? '',
      requestId: randomToken(8),
      timestampIso: new Date().toISOString(),
      responseText: String(injectRes.body || ''),
      responseJson,
      friendlyError: friendlyErrorFromApiBody(responseJson) ?? (injectRes.statusCode >= 400 ? 'Request failed. See raw error for details.' : undefined)
    };

    const consoleHtml = renderConsole({
      sessionEmail: session.email_normalized,
      totalUsers: data.totalUsers,
      tab: 'users',
      usersRowsHtml: data.usersRowsHtml,
      usersQuery,
      usersPage,
      usersPageSize,
      usersTotalMatching: data.usersTotalMatching,
      clients: data.clients,
      clientsQuery,
      activity: data.activity,
      activityClientId,
      activityEmailPrefix,
      form: {
        client_id: body.client_id ?? '',
        email: body.email ?? '',
        redirect_uri: body.redirect_uri ?? '',
        state: body.state ?? 'test',
        app_name: body.app_name ?? '',
        app_return_to: body.app_return_to ?? ''
      },
      output
    });

    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(consoleHtml);
  });

  app.post('/admin/test/token', async (req, reply) => {
    if (!env.admin.enabled) return reply.code(404).send('Not found');
    const session = await requireAdmin(app, req);
    if (!session) return reply.redirect('/admin/login', 302);

    const body = (req.body ?? {}) as {
      client_id?: string;
      client_secret?: string;
      code?: string;
      redirect_uri?: string;
    };

    const injectRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: { 'content-type': 'application/json' },
      payload: {
        client_id: body.client_id ?? '',
        client_secret: body.client_secret ?? '',
        code: body.code ?? '',
        redirect_uri: body.redirect_uri ?? ''
      }
    });

    const usersPage = 1;
    const usersPageSize = 50;
    const usersQuery = '';
    const clientsQuery = '';
    const activityClientId = '';
    const activityEmailPrefix = '';

    const data = await loadConsoleData({
      q: usersQuery,
      usersPage,
      usersPageSize,
      tab: 'users',
      clientsQuery,
      activityClientId,
      activityEmailPrefix
    });

    const responseJson = parseJsonSafe(injectRes.body || '');
    const output = {
      lastAction: 'verify_callback',
      httpStatus: injectRes.statusCode,
      userCreated: undefined,
      client_id: body.client_id ?? '',
      redirect_uri: body.redirect_uri ?? '',
      email: undefined,
      requestId: randomToken(8),
      timestampIso: new Date().toISOString(),
      responseText: String(injectRes.body || ''),
      responseJson,
      friendlyError: friendlyErrorFromApiBody(responseJson) ?? (injectRes.statusCode >= 400 ? 'Request failed. See raw error for details.' : undefined)
    };

    const consoleHtml = renderConsole({
      sessionEmail: session.email_normalized,
      totalUsers: data.totalUsers,
      tab: 'users',
      usersRowsHtml: data.usersRowsHtml,
      usersQuery,
      usersPage,
      usersPageSize,
      usersTotalMatching: data.usersTotalMatching,
      clients: data.clients,
      clientsQuery,
      activity: data.activity,
      activityClientId,
      activityEmailPrefix,
      form: {
        client_id: body.client_id ?? '',
        redirect_uri: body.redirect_uri ?? '',
        code: body.code ?? '',
        client_secret: body.client_secret ?? ''
      },
      output
    });

    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(consoleHtml);
  });
}

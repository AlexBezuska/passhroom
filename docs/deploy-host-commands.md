# Deploy host copy/paste commands

This file exists because some terminals/editors (including VS Code chat rendering) can accidentally rewrite pasted commands into link-markdown.

Private host automation scripts are maintained in `servertron-docs/apps/passhroom/scripts/`.
Public self-hosting does not require those scripts.

## Health checks

Public:

```sh
curl -i https://passhroom.example.com/healthz
```

Local (production enforces HTTPS via header):

```sh
curl -i -H 'x-forwarded-proto: https' http://127.0.0.1:18080/healthz
```

## Run Passhroom migrations

Direct (inside container):

```sh
cd <deploy-root>/passhroom
docker exec -it passhroom-api sh -lc "cd /app && npm run migrate:up"
```

## Trigger admin login email

```sh
curl -i -X POST https://passhroom.example.com/admin/login/start \
	-H 'content-type: application/x-www-form-urlencoded' \
	--data-urlencode 'email=<admin-email>' \
	-o /dev/null
```

## Favicons

```sh
curl -I https://passhroom.example.com/favicon.ico
curl -I https://passhroom.example.com/assets/favicons/favicon-196.png
```

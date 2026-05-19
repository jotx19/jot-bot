# Task state & runtime

## `core/state.js`

Defines **in-memory task records** for one routed turn (one user message through `routeMessage`).

- **Statuses:** `CREATED` → `PLANNING` → `RUNNING` → `COMPLETED` | `FAILED` (and reserved: `WAITING`, `RETRYING`, `CANCELLED` for future schedulers / approvals).
- **Fields:** `id`, timestamps, `retries`, `toolCalls[]`, `failures[]`, `parentTaskId`, `childTaskIds`, `channel` (`web` | `discord`), `inputPreview`.
- Tasks are **not persisted** yet; the client receives a snapshot on each `/api/chat` response / SSE `done` event as `task`.

## `core/runtime.js`

**`runChatTurn(params)`** is the single entry for one turn:

1. Creates a task.
2. Sets lifecycle status, calls `routeMessage(..., { task, ... })`.
3. Records `toolUsed` as a tool call when present.
4. Returns `{ ok, task, result? }` or `{ ok, task, error? }` (no throw on handler failure—transports decide HTTP/SSE shape).

## API

- **SSE `done`:** includes `task` (public JSON).
- **SSE `error`:** includes `task` when the failure happened inside `runChatTurn`.
- **JSON `POST /api/chat`:** includes `task` on success; on failure, `{ error, task }` with status 500.

## Next steps (not done yet)

- Persist tasks (Mongo) keyed by `sessionId` + `task.id`.
- Emit intermediate transitions (e.g. `WAITING` during tool approval).
- Attach `task.id` to session messages for UI drill-down.

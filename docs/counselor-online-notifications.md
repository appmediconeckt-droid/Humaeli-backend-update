# Counselor online bell API

Use the same backend origin as login. The router is mounted at `/api/notifications` in `src/app.js`.

The mobile source currently selects `https://s5jl7g4z-5001.inc1.devtunnels.ms` in `chatbot-app/src/axiosConfig.js`. It also defines `https://chatbot-backend-production-ea76.up.railway.app` as an alternative. These are configuration values, not confirmation that either server has the latest code deployed.

## Subscription

All three operations support both URLs (same subscription data):

```text
{BACKEND_ORIGIN}/api/notifications/counselors/{counselorId}/online-subscription
{BACKEND_ORIGIN}/api/notifications/availability-subscriptions/{counselorId}
```

The mobile app in the reported 404 screenshot uses the second URL. The backend now accepts that path directly; no frontend URL change is required. Restart/deploy the updated backend behind the app's configured origin to activate the alias.

`counselorId` is the counselor's MongoDB `_id` (24 hex characters), not a chat ID, user ID, display name, or the text `undefined`.

| Method | Operation | Successful response |
| --- | --- | --- |
| GET | Load saved bell state | `{ "success": true, "subscribed": true, "counselorId": "..." }` (or `false`) |
| POST | Turn bell on | `{ "success": true, "subscribed": true, "counselorId": "..." }` |
| DELETE | Turn bell off | `{ "success": true, "subscribed": false, "counselorId": "..." }` |

Send `Authorization: Bearer <accessToken>` for the logged-in user. No request body or `userId` is required: the backend takes the subscriber identity from authentication. POST and DELETE are safe to repeat. A previous chat, booking, or connection is not required. POST requires an active counselor and rejects self-subscription.

```js
// api is the existing authenticated Axios instance; baseURL is the backend
// origin without /api. If your baseURL already ends in /api, omit /api below.
const path = `/api/notifications/counselors/${encodeURIComponent(counselorId)}/online-subscription`;
const { data: saved } = await api.get(path);
const { data: enabled } = await api.post(path, {});
const { data: disabled } = await api.delete(path);
```

Update the displayed bell only after a successful response, and restore its saved state with GET when opening the counselor card/screen.

POST also accepts an explicit desired state: `{ "subscribed": true }` or `{ "enabled": true }` turns this counselor's bell on; `false` removes this counselor's subscription, just like DELETE. Values must be JSON booleans, not strings. An empty POST body keeps the original ON behavior. Each bell is stored per authenticated user and counselor; do not share one local boolean across counselor cards. The backend rechecks this exact pair before push delivery. Requests already handed to Firebase cannot be recalled by a later OFF request.

Errors: `400 INVALID_COUNSELOR_ID` for malformed IDs; `401` for missing/invalid login; POST `404` if the counselor is missing/inactive; POST `400` for self-subscription. A generic route `404` instead indicates a wrong URL or a server running code without this route.

## Device push registration

```http
POST /api/notifications/register-token
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "fcmToken": "<device FCM token>", "platform": "android" }
```

`platform` can be `android` or `ios`. `/api/notifications/token` accepts POST or PUT as aliases. Register the current device token after login and when FCM refreshes it.

The backend sends `data.type = COUNSELOR_ONLINE`, `counselorId`, and `counselorName` when a counselor transitions from offline to online. Enabling the bell subscribes to future transitions; it does not immediately notify if the counselor is already online. Push receipt also requires device notification permission and working Firebase credentials on the backend.

Deploy/restart the backend used by the app after applying these changes. Local tests mock Firebase delivery; a real two-device delivery check remains necessary.

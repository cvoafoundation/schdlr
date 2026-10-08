# CVOA.ONE integration

Schedlr remains a separately hosted product in this repository, with its own Supabase project, authentication, organizations, branding, booking URLs, and customer signup. CVOA.ONE contains a connector screen only. The scheduler is not copied into that application.

## Access

CVOA.ONE embeds `/integrations/cvoa`. The two applications exchange a CVOA access token through exact-origin, exact-window `postMessage`, never a URL. Schedlr forwards it to `connect-cvoa`, which verifies it against the fixed CVOA Auth project and calls the authenticated `cvoa_schedlr_context` RPC. Roles and organization IDs in browser request bodies are ignored.

The connector creates a separate random-address integration identity, so connecting an existing CVOA account cannot merge or change the person's commercial Schedlr accounts. It uses a one-time magic-link token to establish the Schedlr session without sending an email. Embedded sessions use memory, leaving standalone browser sessions intact.

National receives National, state, and post calendars. State commanders receive their assigned states and posts. Post commanders/officers receive their assigned posts. Designated congressional delegates receive their assigned post calendars; a role label without a designation is insufficient. Ordinary membership does not grant staff access. Ethics access is excluded.

Derived memberships expire after five minutes and renew every two minutes while the CVOA screen is open. The database checks expiry on every protected query. A verified session with no remaining staff appointment revokes its derived memberships. Imported appointments cannot be edited or independently invited through Schedlr. Use CVOA.ONE Accounts & Access.

Calendars are provisioned on first use. Their bookable staff are added when those staff first connect. Oversight does not automatically publish National or state leaders as bookable staff at every post. Published staff calendars remain bookable while staff are offline; appointment access is separately leased. Public staff listings reflect the last verified synchronization until the staff account next connects. Existing standalone memberships and historical appointments in the original CVOA calendar are retained.

## Public booking

Customers have `/book/:slug` URLs and personal links using `?with=<user UUID>`. The database validates organization, staff assignment, actual availability, minimum notice, daily limits, group capacity, and authoritative session duration. Repeating bookings commit together or roll back together. Public availability omits confidential time-off labels.

New confirmations provide an unguessable private management link. The token is a URL fragment, is stored only as a SHA-256 hash, and authorizes only the relevant appointment/series or individual group attendance. Cancelling attendance does not cancel a group. Old bookings without private links require staff assistance; knowledge of an email address no longer grants guest access.

## Release order

1. Apply the CVOA `20261008193802_cvoa_schedlr_connector.sql` migration.
2. Apply this repository's `20261008193800_cvoa_connector_and_customer_isolation.sql` migration and deploy `connect-cvoa` with `verify_jwt=false`. The endpoint implements explicit authentication of the external CVOA token; platform JWT verification cannot validate another project's tokens.
3. Deploy Schedlr and CVOA.ONE from the tested commits. Schedlr still uses its existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The connector uses its own project's service key supplied by the Edge runtime and the CVOA publishable key, never a CVOA service key.

`npm test` runs PostgreSQL permission/booking tests and connector authentication tests. `npm run build` builds the independent application. CVOA's connected-accounts suite separately tests the authoritative scope RPC.

Company subscriptions and checkout remain a separate commercial-product task; this connector does not activate customer billing or change plan prices. Meeting bookings do not promise external-calendar conflict synchronization.

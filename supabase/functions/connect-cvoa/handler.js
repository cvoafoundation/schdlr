// The external session is authenticated against the fixed CVOA Auth server.
// Browser-supplied identities, roles, emails and organization IDs are ignored.
const origins = new Set(['https://schdlr.vercel.app', 'https://schdlr-m54.vercel.app']);
export function createConnector({ cvoa, service }) {
  return async function handle(req) {
    const origin = req.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origins.has(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type,apikey', 'Access-Control-Allow-Methods': 'POST,OPTIONS' });
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.has(origin)) return reply(403, { error: 'Origin is not allowed.' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    const token = req.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token || token.length > 12000) return reply(401, { error: 'CVOA sign-in required.' });
    try {
      const source = cvoa(token);
      const { data: identity, error: authError } = await source.auth.getUser(token);
      if (authError || !identity?.user?.id) return reply(401, { error: 'CVOA session is invalid or expired.' });
      const { data: context, error: scopeError } = await source.rpc('cvoa_schedlr_context');
      if (scopeError || !Array.isArray(context?.workspaces)) return reply(403, { error: 'Could not verify your CVOA appointment.' });
      const admin = service();
      const external = identity.user.id;
      let { data: userId, error: mapError } = await admin.rpc('cvoa_connector_identity', { p_external_id: external });
      if (mapError) throw new Error('Identity lookup failed');
      if (!context.workspaces.length) {
        if (userId) {
          const { error } = await admin.rpc('cvoa_connector_sync', { p_external_id: external, p_name: context.name, p_workspaces: [] });
          if (error) throw new Error('Revocation failed');
        }
        return reply(403, { error: 'A current CVOA staff appointment is required.' });
      }
      if (!userId) {
        // Random address prevents pre-registration of a predictable SSO identity.
        const { data, error } = await admin.auth.admin.createUser({ email: `integration-${crypto.randomUUID()}@accounts.schedlr.invalid`, password: `${crypto.randomUUID()}${crypto.randomUUID()}`, email_confirm: true, user_metadata: { name: context.name || 'CVOA staff' } });
        if (error || !data.user) throw new Error('Identity creation failed');
        const candidate = data.user.id;
        const bound = await admin.rpc('cvoa_connector_identity', { p_external_id: external, p_user_id: candidate });
        if (bound.error || !bound.data) {
          await admin.auth.admin.deleteUser(candidate);
          throw new Error('Identity binding failed');
        }
        userId = bound.data;
        if (userId !== candidate) await admin.auth.admin.deleteUser(candidate);
      }
      const { data: workspaces, error: syncError } = await admin.rpc('cvoa_connector_sync', { p_external_id: external, p_name: context.name, p_workspaces: context.workspaces });
      if (syncError) throw new Error('Workspace synchronization failed');
      const { data: account, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError || !account.user?.email) throw new Error('Identity is unavailable');
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: account.user.email });
      if (linkError || !link.properties?.hashed_token) throw new Error('Session creation failed');
      const preferred = workspaces.find(w => w.key === context.selected_key) || workspaces[0];
      return reply(200, { token_hash: link.properties.hashed_token, user_id: userId, organization_id: preferred.organization_id });
    } catch {
      // No JWTs, provider errors, guest data or synthetic credentials in logs.
      return reply(503, { error: 'Scheduling connection is temporarily unavailable. Please retry.' });
    }
  };
}

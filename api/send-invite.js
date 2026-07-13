// Vercel automatically turns any file in /api into a live serverless
// endpoint — no separate deployment step, no CLI. It ships with the rest of
// the app whenever you push to GitHub. This one talks to Resend's email API
// using a secret key that never reaches the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, role, invite_link, organization_name } = req.body || {};
  if (!email || !invite_link) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Email sending isn't configured yet — set RESEND_API_KEY in Vercel." });
  }

  const orgName = organization_name || "the team";
  const fromAddress = process.env.INVITE_FROM_EMAIL || "onboarding@resend.dev";

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress,
        to: email,
        subject: `You're invited to join ${orgName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <p>You've been invited to join <strong>${orgName}</strong> as <strong>${role}</strong>.</p>
            <p>
              <a href="${invite_link}" style="display:inline-block; background:#111110; color:#fff; padding:10px 20px; text-decoration:none; border-radius:2px;">
                Accept invitation
              </a>
            </p>
            <p style="color:#888; font-size:13px;">If that button doesn't work, copy this link into your browser:<br>${invite_link}</p>
          </div>
        `,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: data });
    }
    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to send email" });
  }
}

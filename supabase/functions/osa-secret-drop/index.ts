import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const enc = new TextEncoder();
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST,OPTIONS",
  "cache-control": "no-store",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });

async function sha256(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(value)),
  );
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getToken(raw: string) {
  if (!raw) return null;
  const hash = await sha256(raw);
  const { data, error } = await db
    .from("osa_secret_drop_tokens")
    .select("id,secret_name,expires_at,used_at")
    .eq("token_hash", hash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("secret_drop_lookup_failed", error.message);
    return null;
  }
  return data;
}

async function consumeAndStore(raw: string, secret: string) {
  const hash = await sha256(raw);
  const { data, error } = await db.rpc("osa_consume_secret_drop", {
    p_token_hash: hash,
    p_value: secret,
  });

  if (error) {
    console.error("secret_drop_store_failed", error.message);
    return { ok: false, error: "store_failed" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row
    ? { ok: true, row }
    : { ok: false, error: "expired_or_used" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "OSA Secure Secret Drop API",
      version: 5,
      interactive_html: false,
      note:
        "Supabase Edge Functions do not serve HTML. Use the OSA Secret Drop frontend.",
    });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const contentType = req.headers.get("content-type") || "";
  let token = "";
  let secret = "";
  let validate = false;

  if (contentType.includes("application/json")) {
    const body: any = await req.json().catch(() => ({}));
    token = String(body?.token || "").trim();
    secret = String(body?.secret || "").trim();
    validate = body?.validate === true || body?.action === "validate";
  } else {
    const form = await req.formData().catch(() => null);
    token = String(form?.get("token") || "").trim();
    secret = String(form?.get("secret") || "").trim();
    validate = String(form?.get("validate") || "") === "true";
  }

  if (!token || token.length < 32 || token.length > 512) {
    return json({ ok: false, valid: false, error: "invalid_token" }, 400);
  }

  if (validate) {
    const row = await getToken(token);
    if (!row) {
      return json({ ok: false, valid: false, error: "expired_or_used" }, 410);
    }

    return json({
      ok: true,
      valid: true,
      secret_name: String(row.secret_name),
      expires_at: row.expires_at,
    });
  }

  if (secret.length < 16 || secret.length > 16384) {
    return json({ ok: false, error: "invalid_secret_length" }, 400);
  }

  const result = await consumeAndStore(token, secret);
  if (!result.ok) {
    if (result.error === "expired_or_used") {
      return json({ ok: false, error: "expired_or_used" }, 410);
    }
    return json({ ok: false, error: "store_failed" }, 500);
  }

  return json(
    {
      ok: true,
      stored: true,
      message: "Secret stored in Supabase Vault. It will not be returned.",
    },
    201,
  );
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

Deno.serve(async (req) => {
  try {
    const { paymentId, adminUserId, status, rejectionReason, bankReference } = await req.json();

    if (!paymentId || !adminUserId || !status) {
      return new Response(JSON.stringify({ error: 'paymentId, adminUserId and status are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: adminProfile, error: adminError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', adminUserId)
      .single();

    if (adminError || !adminProfile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Forbidden: administrator permissions required' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, customer_id, amount, status, payment_reference')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return new Response(JSON.stringify({ error: 'Payment not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (payment.status === 'approved') {
      return new Response(JSON.stringify({ error: 'Duplicate approval prevented: payment already approved' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    const nextStatus = status === 'approved' ? 'approved' : 'rejected';

    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: nextStatus,
        reviewed_by: adminUserId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: nextStatus === 'rejected' ? rejectionReason ?? 'Rejected by admin' : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (updateError) throw updateError;

    if (nextStatus === 'approved') {
      const rawCode = `${payment.customer_id.slice(0, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawCode));
      const codeHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

      const { error: codeError } = await supabase.from('activation_codes').insert({
        customer_id: payment.customer_id,
        payment_id: payment.id,
        code_hash: codeHash,
        created_by: adminUserId,
        status: 'unused',
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (codeError) throw codeError;

      await supabase.from('audit_logs').insert({
        actor_id: adminUserId,
        action: 'payment_approved',
        object_type: 'payment',
        object_id: payment.id,
        metadata: {
          customer_id: payment.customer_id,
          bank_reference: bankReference ?? payment.payment_reference,
          activation_code_generated: true,
        },
      });
    }

    return new Response(JSON.stringify({ ok: true, status: nextStatus }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});

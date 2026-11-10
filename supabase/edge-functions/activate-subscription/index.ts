import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

Deno.serve(async (req) => {
  try {
    const { activationCode, customerId, installationId, deviceName, platform } = await req.json();

    if (!activationCode || !customerId || !installationId) {
      return new Response(JSON.stringify({ error: 'activationCode, customerId and installationId are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: customer, error: customerError } = await supabase
      .from('profiles')
      .select('id, email_verified, is_admin')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .upsert({
        customer_id: customerId,
        installation_id: installationId,
        device_name: deviceName ?? 'Android device',
        device_platform: platform ?? 'android',
        status: 'active',
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'customer_id,installation_id' })
      .select()
      .single();

    if (deviceError || !device) throw deviceError ?? new Error('Could not register device');

    const { data: subscription, error: subscriptionError } = await supabase.rpc('redeem_activation_code', {
      p_customer_id: customerId,
      p_code: activationCode,
      p_device_id: device.id,
    });

    if (subscriptionError) {
      return new Response(JSON.stringify({ error: subscriptionError.message || 'Activation failed' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, subscription }), {
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

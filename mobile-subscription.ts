import { createClient } from '@supabase/supabase-js';

export type ActivationPayload = {
  activationCode: string;
  customerId: string;
  installationId: string;
  deviceName?: string;
  platform?: 'android' | 'ios';
};

export type SubscriptionStatus = {
  active: boolean;
  expiresAt: string | null;
  status: string;
  deviceAllowed: boolean;
};

export class MobileSubscriptionService {
  private client;
  private readonly url: string;

  constructor(url: string, anonKey: string) {
    this.url = url;
    this.client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  async signUp(email: string, password: string, fullName: string) {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) throw error;
    return data;
  }

  async submitPayment(paymentReference: string, amount: number, receiptUrl?: string) {
    const { data: { user }, error: userError } = await this.client.auth.getUser();
    if (userError || !user) throw new Error('User must be logged in');

    const { data, error } = await this.client.from('payments').insert({
      customer_id: user.id,
      payment_reference: paymentReference,
      amount,
      currency: 'UGX',
      payment_method: 'bank_transfer',
      receipt_url: receiptUrl ?? null,
      status: 'pending',
    });

    if (error) throw error;
    return data;
  }

  async activateWithCode(payload: ActivationPayload) {
    const { data: { user }, error: userError } = await this.client.auth.getUser();
    if (userError || !user) throw new Error('User must be logged in');

    const { data: { session }, error: sessionError } = await this.client.auth.getSession();
    if (sessionError || !session) throw new Error('User session is required for activation');

    const response = await fetch(`${this.url}/functions/v1/activate-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ...payload,
        customerId: user.id,
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      throw new Error(body?.error || 'Activation failed');
    }

    return response.json();
  }

  async recordUsageEvent(eventType: 'activation' | 'usage' | 'renewal' | 'device_lock' | 'login', metadata: Record<string, unknown> = {}) {
    const { data: { user }, error: userError } = await this.client.auth.getUser();
    if (userError || !user) throw new Error('User must be logged in');

    const { error } = await this.client.from('usage_events').insert({
      customer_id: user.id,
      event_type: eventType,
      metadata,
    });

    if (error) throw error;
    return true;
  }

  async getAccessState(): Promise<SubscriptionStatus> {
    const { data: { user }, error: userError } = await this.client.auth.getUser();
    if (userError || !user) {
      return { active: false, expiresAt: null, status: 'logged_out', deviceAllowed: false };
    }

    const { data, error } = await this.client
      .from('subscriptions')
      .select('status, expires_at, device_id')
      .eq('customer_id', user.id)
      .order('expires_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return { active: false, expiresAt: null, status: 'inactive', deviceAllowed: true };
    }

    const active = data.status === 'active' && new Date(data.expires_at) > new Date();
    return {
      active,
      expiresAt: data.expires_at,
      status: data.status,
      deviceAllowed: active,
    };
  }
}

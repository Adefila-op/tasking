import { useEffect, useMemo, useState } from 'react';

type Stat = {
  label: string;
  value: string;
  detail: string;
};

type Plan = {
  name: string;
  price: string;
  validity: string;
  highlight?: boolean;
};

type UsageRecord = {
  event: string;
  value: string;
  when: string;
};

type AccountState = {
  fullName: string;
  email: string;
  password: string;
  isLoggedIn: boolean;
  selectedPlan: string;
  isActive: boolean;
  accessCode: string;
  device: string;
  expiresAt: string;
};

const defaultUsageRows: UsageRecord[] = [
  { event: 'Activation redeemed', value: 'A1M-2209', when: 'Today · 08:41' },
  { event: 'Usage session', value: '14 actions', when: 'Today · 07:24' },
  { event: 'Device switch blocked', value: 'Primary device only', when: 'Yesterday · 19:12' },
  { event: 'Subscription renewed', value: 'Extension +14 days', when: 'Yesterday · 10:06' },
];

const plans: Plan[] = [
  { name: 'Starter', price: 'UGX 15,000', validity: '14 days', highlight: true },
  { name: 'Growth', price: 'UGX 45,000', validity: '45 days' },
  { name: 'Business', price: 'UGX 120,000', validity: '120 days' },
];

const storageKey = 'tasking-portal-state-v1';

const createDefaultAccount = (): AccountState => ({
  fullName: '',
  email: '',
  password: '',
  isLoggedIn: false,
  selectedPlan: 'Starter',
  isActive: false,
  accessCode: 'Not activated',
  device: 'Not assigned',
  expiresAt: 'Not activated',
});

const formatExpiry = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function App() {
  const [view, setView] = useState<'signup' | 'login'>('signup');
  const [showPassword, setShowPassword] = useState(false);
  const [account, setAccount] = useState<AccountState>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : createDefaultAccount();
  });
  const [usageRows, setUsageRows] = useState<UsageRecord[]>(defaultUsageRows);
  const [statusMessage, setStatusMessage] = useState('Create an account to unlock your access code.');
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(account));
  }, [account]);

  const stats: Stat[] = useMemo(() => {
    return [
      { label: 'Active users', value: account.isActive ? '1,421' : '1,284', detail: account.isActive ? '+8.5% this month' : '+7.2% this month' },
      { label: 'Activation codes', value: account.isActive ? '318' : '316', detail: account.isActive ? '1 active now' : '89 unused' },
      { label: 'Daily app opens', value: account.isActive ? '914' : '842', detail: 'Across Android + iOS' },
      { label: 'Renewals', value: account.isActive ? '174' : '163', detail: '14-day cycle' },
    ];
  }, [account.isActive]);

  const handleSignup = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { fullName, email, password } = form;

    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setStatusMessage('Please fill in your full name, email, and password.');
      return;
    }

    const nextAccount: AccountState = {
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      isLoggedIn: true,
      selectedPlan: 'Starter',
      isActive: false,
      accessCode: 'Not activated',
      device: 'Not assigned',
      expiresAt: 'Not activated',
    };

    setAccount(nextAccount);
    setStatusMessage(`Welcome ${nextAccount.fullName}! Your account is ready. Pick a plan to activate access.`);
    setView('login');
  };

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const sameEmail = loginForm.email.trim().toLowerCase() === account.email.toLowerCase();
    const samePassword = loginForm.password === account.password;

    if (!account.email || !sameEmail || !samePassword) {
      setStatusMessage('Login failed. Check your email and password or create an account first.');
      return;
    }

    setAccount((previous) => ({ ...previous, isLoggedIn: true }));
    setStatusMessage(`You are logged in as ${account.fullName}.`);
  };

  const handleBuyPlan = (planName: string) => {
    if (!account.email || !account.isLoggedIn) {
      setStatusMessage('Please create an account or login before buying an activation code.');
      return;
    }

    const chosenPlan = plans.find((plan) => plan.name === planName) ?? plans[0];
    const accessCode = `TR-${Math.floor(1000 + Math.random() * 9000)}`;
    const expiry = formatExpiry(chosenPlan.name === 'Business' ? 120 : chosenPlan.name === 'Growth' ? 45 : 14);

    const nextAccount: AccountState = {
      ...account,
      selectedPlan: chosenPlan.name,
      isActive: true,
      accessCode,
      device: 'This device',
      expiresAt: expiry,
    };

    setAccount(nextAccount);
    setUsageRows((previous) => [
      { event: 'Activation redeemed', value: accessCode, when: 'Just now' },
      ...previous,
    ]);
    setStatusMessage(`${chosenPlan.name} plan activated successfully. Access code ${accessCode} is now active.`);
  };

  const handleDownload = (target: 'Android' | 'iOS' | 'Portal') => {
    setStatusMessage(
      target === 'Android'
        ? 'Android APK link is ready for distribution.'
        : target === 'iOS'
          ? 'iOS build is ready for TestFlight or Apple signed release.'
          : 'Portal is open and ready for account management.'
    );
  };

  return (
    <div className="portal-shell">
      <header className="topbar container">
        <div className="brand-block">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand">Tasking</div>
            <div className="subtitle">Access portal</div>
          </div>
        </div>

        <nav className="nav">
          <a href="#downloads">Downloads</a>
          <a href="#plans">Plans</a>
          <a href="#usage">Usage</a>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setView((current) => (current === 'login' ? 'signup' : 'login'))}
          >
            {account.isLoggedIn ? 'Account' : 'Login'}
          </button>
        </nav>
      </header>

      <main className="container">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Customer portal</span>
            <h1>
              Create your account,<span className="accent"> install the app</span>, and activate your subscription.
            </h1>
            <p>
              Users can sign up online, download the Android or iOS app, buy an activation code,
              and track usage and device access from one central place.
            </p>
            <div className="cta-row">
              <button type="button" className="primary-button" onClick={() => setView('signup')}>
                Create account
              </button>
              <button type="button" className="secondary-button" onClick={() => handleDownload('Portal')}>
                Download app
              </button>
            </div>
            <div className="trust-row">
              <span>Secure checkout</span>
              <span>Device locking</span>
              <span>Usage analytics</span>
            </div>
            <div className="feature-row">
              <div className="feature-box">
                <div className="feature-badge">✓</div>
                <div>
                  <strong>One device lock</strong>
                  <span>Primary access only</span>
                </div>
              </div>
              <div className="feature-box">
                <div className="feature-badge">⚡</div>
                <div>
                  <strong>Instant activation</strong>
                  <span>Redeem in seconds</span>
                </div>
              </div>
              <div className="feature-box">
                <div className="feature-badge">📊</div>
                <div>
                  <strong>Usage tracking</strong>
                  <span>Live activity feed</span>
                </div>
              </div>
              <div className="feature-box">
                <div className="feature-badge">🔒</div>
                <div>
                  <strong>Secure billing</strong>
                  <span>Verified access</span>
                </div>
              </div>
            </div>
          </div>

          <div className="auth-panel">
            <div className="panel-header">{view === 'signup' ? 'Welcome' : 'Login'}</div>
            <div className="panel-subtitle">
              {view === 'signup' ? 'Create your customer account' : 'Welcome back'}
            </div>

            {view === 'signup' ? (
              <form className="form-grid" onSubmit={handleSignup}>
                <div className="field-wrap">
                  <span className="field-icon">👤</span>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={form.fullName}
                    onChange={(event) => setForm((previous) => ({ ...previous, fullName: event.target.value }))}
                  />
                </div>
                <div className="field-wrap">
                  <span className="field-icon">✉️</span>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={form.email}
                    onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
                  />
                </div>
                <div className="field-wrap">
                  <span className="field-icon">🔑</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={form.password}
                    onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))}
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                <button type="submit" className="primary-button full">Create account</button>
              </form>
            ) : (
              <form className="form-grid" onSubmit={handleLogin}>
                <div className="field-wrap">
                  <span className="field-icon">✉️</span>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((previous) => ({ ...previous, email: event.target.value }))}
                  />
                </div>
                <div className="field-wrap">
                  <span className="field-icon">🔑</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((previous) => ({ ...previous, password: event.target.value }))}
                  />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                <button type="submit" className="primary-button full">Login</button>
              </form>
            )}

            <div className="panel-footer">
              {view === 'signup' ? (
                <>
                  Already have an account?{' '}
                  <button type="button" className="text-link" onClick={() => setView('login')}>
                    Login
                  </button>
                </>
              ) : (
                <>
                  Need a new account?{' '}
                  <button type="button" className="text-link" onClick={() => setView('signup')}>
                    Create account
                  </button>
                </>
              )}
            </div>

            <div className="status-banner">{statusMessage}</div>
          </div>
        </section>

        <section className="stats-grid">
          {stats.map((stat) => (
            <article key={stat.label} className="card metric-card">
              <span className="metric-label">{stat.label}</span>
              <span className="metric-value">{stat.value}</span>
              <span className="metric-detail">{stat.detail}</span>
            </article>
          ))}
        </section>

        <section id="downloads" className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">Download center</span>
              <h2>Install on Android or iPhone</h2>
            </div>
          </div>

          <div className="download-grid">
            <article className="card download-card">
              <div className="download-title">Android APK</div>
              <p>Direct installation for Android devices, ready for distribution.</p>
              <button type="button" className="primary-button" onClick={() => handleDownload('Android')}>
                Download APK
              </button>
            </article>

            <article className="card download-card">
              <div className="download-title">iOS build</div>
              <p>TestFlight-ready iOS package for approved testers and signed builds.</p>
              <button type="button" className="secondary-button" onClick={() => handleDownload('iOS')}>
                Download iOS
              </button>
            </article>

            <article className="card download-card">
              <div className="download-title">Web account</div>
              <p>Manage activation and review current subscription status from your portal.</p>
              <button type="button" className="secondary-button" onClick={() => handleDownload('Portal')}>
                Open portal
              </button>
            </article>
          </div>
        </section>

        <section id="plans" className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">Activation</span>
              <h2>Buy your access code</h2>
            </div>
          </div>

          <div className="plans-grid">
            {plans.map((plan) => (
              <article key={plan.name} className={`card plan-card ${plan.highlight ? 'featured' : ''}`}>
                <div className="plan-name">{plan.name}</div>
                <div className="plan-price">{plan.price}</div>
                <div className="plan-validity">{plan.validity}</div>
                <ul>
                  <li>Fast activation</li>
                  <li>Single-device lock</li>
                  <li>Usage tracking enabled</li>
                </ul>
                <button
                  type="button"
                  className={plan.highlight ? 'primary-button full' : 'secondary-button full'}
                  onClick={() => handleBuyPlan(plan.name)}
                >
                  Buy now
                </button>
              </article>
            ))}
          </div>
        </section>

        <section id="usage" className="section usage-layout">
          <div className="card usage-panel">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Account status</span>
                <h3>Subscription overview</h3>
              </div>
            </div>

            <div className="status-block">
              <div>
                <span className="status-label">Current plan</span>
                <strong>{account.isActive ? account.selectedPlan : 'None'}</strong>
              </div>
              <span className={`badge ${account.isActive ? 'active' : 'inactive'}`}>
                {account.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="status-row">
              <div>
                <span className="status-label">Activation</span>
                <strong>{account.accessCode}</strong>
              </div>
              <div>
                <span className="status-label">Expires</span>
                <strong>{account.expiresAt}</strong>
              </div>
            </div>

            <div className="status-row">
              <div>
                <span className="status-label">Current device</span>
                <strong>{account.device}</strong>
              </div>
              <div>
                <span className="status-label">User</span>
                <strong>{account.fullName || 'Not created'}</strong>
              </div>
            </div>
          </div>

          <div className="card table-panel">
            <div className="section-head compact">
              <div>
                <span className="eyebrow">Usage tracking</span>
                <h3>Recent activity</h3>
              </div>
            </div>

            <table className="usage-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Value</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((row) => (
                  <tr key={`${row.event}-${row.when}`}>
                    <td>{row.event}</td>
                    <td>{row.value}</td>
                    <td>{row.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

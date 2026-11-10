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

const stats: Stat[] = [
  { label: 'Active users', value: '1,284', detail: '+7.2% this month' },
  { label: 'Activation codes', value: '316', detail: '89 unused' },
  { label: 'Daily app opens', value: '842', detail: 'Across Android + iOS' },
  { label: 'Renewals', value: '163', detail: '14-day cycle' },
];

const plans: Plan[] = [
  { name: 'Starter', price: 'UGX 25,000', validity: '14 days' },
  { name: 'Growth', price: 'UGX 75,000', validity: '45 days', highlight: true },
  { name: 'Business', price: 'UGX 180,000', validity: '120 days' },
];

const usageRows: UsageRecord[] = [
  { event: 'Activation redeemed', value: 'A1M-2209', when: 'Today · 08:41' },
  { event: 'Usage session', value: '14 actions', when: 'Today · 07:24' },
  { event: 'Device switch blocked', value: 'Primary device only', when: 'Yesterday · 19:12' },
  { event: 'Subscription renewed', value: 'Extension +14 days', when: 'Yesterday · 10:06' },
];

export default function App() {
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
          <button className="ghost-button">Login</button>
        </nav>
      </header>

      <main className="container">
        <section className="hero card">
          <div className="hero-copy">
            <span className="eyebrow">Customer portal</span>
            <h1>Create your account, install the app, and activate your subscription in minutes.</h1>
            <p>
              Users can sign up online, download the Android or iOS app, buy an activation code,
              and track real usage and activation activity from one central place.
            </p>
            <div className="cta-row">
              <button className="primary-button">Create account</button>
              <button className="secondary-button">Download app</button>
            </div>
            <div className="trust-row">
              <span>Secure checkout</span>
              <span>Device locking</span>
              <span>Usage analytics</span>
            </div>
          </div>

          <div className="auth-panel">
            <div className="panel-header">Welcome</div>
            <div className="form-grid">
              <input type="text" placeholder="Full name" />
              <input type="email" placeholder="Email address" />
              <input type="password" placeholder="Password" />
              <button className="primary-button full">Create account</button>
            </div>
            <div className="panel-footer">Already have an account? <a href="#">Login</a></div>
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
              <p>Direct installation for Android devices, ready for production distribution.</p>
              <button className="primary-button">Download APK</button>
            </article>

            <article className="card download-card">
              <div className="download-title">iOS build</div>
              <p>Distribution-ready iOS package for testers and approved device enrollment.</p>
              <button className="secondary-button">Download iOS</button>
            </article>

            <article className="card download-card">
              <div className="download-title">Web account</div>
              <p>Create an account, manage activation, and review current subscription status.</p>
              <button className="secondary-button">Open portal</button>
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
                  <li>14-day activation window</li>
                  <li>Single-device lock</li>
                  <li>Usage tracking enabled</li>
                </ul>
                <button className={plan.highlight ? 'primary-button full' : 'secondary-button full'}>
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
                <strong>Growth</strong>
              </div>
              <span className="badge active">Active</span>
            </div>

            <div className="status-row">
              <div>
                <span className="status-label">Activation</span>
                <strong>TR-2991</strong>
              </div>
              <div>
                <span className="status-label">Expires</span>
                <strong>12 Jan 2026</strong>
              </div>
            </div>

            <div className="status-row">
              <div>
                <span className="status-label">Current device</span>
                <strong>Samsung S24</strong>
              </div>
              <div>
                <span className="status-label">Lock status</span>
                <strong>Primary device</strong>
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

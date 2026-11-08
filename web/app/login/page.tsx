export default function Login() {
  return (
    <div className="card">
      <h1 className="text-2xl font-semibold">Customer Integration Console</h1>
      <p className="muted mt-2">Sign in with your company identity provider (single sign-on).</p>
      <a href="/api/auth/login" className="btn mt-6 inline-block" data-testid="sso-login">Sign in with SSO</a>
    </div>
  );
}

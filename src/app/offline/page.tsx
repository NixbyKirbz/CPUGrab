import Link from 'next/link';
export default function Page() {
  return (
    <main id="main-content" className="offline-page">
      <div>
        <img src="/brand/logo.png" alt="CPUGrab" />
        <h1>A little pause in your day.</h1>
        <p>
          Reconnect to reserve meals or claim a pickup. Previously loaded public menus remain
          available in an open app.
        </p>
        <Link href="/student/home" className="primary-button">
          Try again
        </Link>
      </div>
    </main>
  );
}

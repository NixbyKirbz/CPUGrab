'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function Install() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const initialize = setTimeout(() => {
      setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
      setInstalled(matchMedia('(display-mode: standalone)').matches);
    }, 0);
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', done);
    return () => {
      clearTimeout(initialize);
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  if (installed) return <p className="help-text">CPUGrab is installed on this device.</p>;
  return (
    <>
      <button
        className="secondary-button full-width"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            await prompt.userChoice;
            setPrompt(null);
          } else setHelp(!help);
        }}
      >
        <Download size={17} />
        Install CPUGrab
      </button>
      {help && (
        <p className="notice">
          {ios
            ? 'In Safari, tap Share, then Add to Home Screen, and tap Add.'
            : 'Open your browser menu and choose “Install CPUGrab” or “Install app” when available. Installation requires HTTPS (or localhost) and a compatible browser.'}{' '}
          You can also keep using CPUGrab in your browser.
        </p>
      )}
    </>
  );
}

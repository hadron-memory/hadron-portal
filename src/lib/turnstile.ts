/** Explicit rendering survives SPA navigation; no visitor token is stored here. */
export interface TurnstileApi {
  render(container: HTMLElement, options: { sitekey: string; 'expired-callback': () => void; 'error-callback': () => void }): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }
let loading: Promise<TurnstileApi> | undefined;
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timer = setTimeout(() => failed(), 15000);
    function failed() {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Challenge unavailable'));
    }
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else failed();
    };
    script.onerror = failed;
    document.head.appendChild(script);
  }).catch((error) => { loading = undefined; throw error; });
  return loading;
}

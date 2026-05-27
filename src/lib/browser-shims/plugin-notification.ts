export async function isPermissionGranted(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  return Notification.permission === 'granted';
}

export async function requestPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.requestPermission();
}

export function sendNotification(opts: { title: string; body?: string }): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    console.info('[browser-shim/notification]', opts.title, opts.body ?? '');
    return;
  }
  new Notification(opts.title, { body: opts.body });
}

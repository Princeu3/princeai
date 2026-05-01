/**
 * Browser notifications wrapper. We use the Notification API (not Web Push);
 * notifications fire only when the tab is open (focused or backgrounded).
 */

let permissionRequested = false;

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  if (permissionRequested) return Notification.permission;
  permissionRequested = true;
  return await Notification.requestPermission();
}

export function tabIsHidden(): boolean {
  return document.visibilityState === "hidden";
}

export function fireNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!tabIsHidden()) return; // don't nag when the user is looking at the tab
  try {
    const n = new Notification(title, { body, icon: undefined });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // ignore
  }
}

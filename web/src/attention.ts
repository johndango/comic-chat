import type { Alert } from "./notifications";

/** Add or replace the unread prefix without disturbing the app's title. */
export function titleWithCount(base: string, unread: number): string {
  const clean = base.replace(/^\(\d+\+?\)\s+/u, "");
  if (unread <= 0) return clean;
  return `(${unread > 99 ? "99+" : unread}) ${clean}`;
}

export class TabAttention {
  private baseTitle: string;
  private readonly originalIcons: { link: HTMLLinkElement; href: string }[];
  private iconImage?: HTMLImageElement;

  constructor(private readonly doc: Document = document) {
    this.baseTitle = doc.title;
    this.originalIcons = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
      .map((link) => ({ link, href: link.href }));
  }

  setBaseTitle(title: string): void {
    this.baseTitle = title.replace(/^\(\d+\+?\)\s+/u, "");
  }

  show(unread: number): void {
    this.doc.title = titleWithCount(this.baseTitle, unread);
    if (unread <= 0) {
      for (const { link, href } of this.originalIcons) link.href = href;
      return;
    }
    void this.badge(unread);
  }

  private async badge(unread: number): Promise<void> {
    const source = this.originalIcons.find(({ link }) => link.sizes?.value === "32x32") ?? this.originalIcons[0];
    if (!source) return;
    try {
      if (!this.iconImage) {
        const image = new Image();
        image.src = source.href;
        await image.decode();
        this.iconImage = image;
      }
      const canvas = this.doc.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(this.iconImage, 0, 0, 32, 32);
      context.fillStyle = "#d61f1f";
      context.beginPath();
      context.arc(22, 10, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff";
      context.font = "bold 13px Tahoma, Verdana, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(unread > 9 ? "9+" : String(unread), 22, 11);
      const url = canvas.toDataURL("image/png");
      for (const { link } of this.originalIcons) link.href = url;
    } catch {
      // The title count remains useful if an icon cannot be decoded or drawn.
    }
  }
}

let audio: AudioContext | undefined;

/** A short synthesized two-note chime, so no sound asset is required. */
export function chime(): void {
  try {
    const AudioContextClass = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    audio ??= new AudioContextClass();
    const now = audio.currentTime;
    for (const [offset, frequency] of [[0, 880], [0.12, 1318.5]] as const) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.4);
    }
  } catch {
    // Browsers without usable Web Audio stay quiet.
  }
}

export type DesktopPermission = "granted" | "denied" | "default" | "unsupported";

export function desktopPermission(): DesktopPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Show a desktop alert; clicking it brings the open Comic Chat tab forward. */
export function showDesktop(alert: Alert, icon?: string): void {
  if (desktopPermission() !== "granted") return;
  try {
    const notification = new Notification(alert.title, {
      body: alert.body,
      tag: `webcomicchat-${alert.kind}`,
      ...(icon ? { icon } : {}),
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some browsers require service-worker notifications; tab alerts still work.
  }
}

export interface ChatLine {
  id: string;
  userId: string;
  user: string;
  text: string;
  at: number;
  isMod: boolean;
  isVip: boolean;
  isSub: boolean;
  isBroadcaster: boolean;
}

/** Mémoire glissante des derniers messages du chat (contexte pour l'IA). */
export class ChatHistory {
  private lines: ChatLine[] = [];
  constructor(private readonly max = 200) {}

  push(line: ChatLine): void {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  recent(count: number): ChatLine[] {
    return this.lines.slice(-count);
  }

  since(ms: number, now = Date.now()): ChatLine[] {
    return this.lines.filter((l) => now - l.at <= ms);
  }

  fromUser(userId: string, count: number): ChatLine[] {
    return this.lines.filter((l) => l.userId === userId).slice(-count);
  }

  /** Format texte compact "pseudo: message" à donner au modèle. */
  static format(lines: ChatLine[]): string {
    return lines
      .map((l) => {
        const badges = [l.isBroadcaster && "streamer", l.isMod && "modo", l.isVip && "vip", l.isSub && "sub"].filter(Boolean);
        return `${l.user}${badges.length ? ` [${badges.join(",")}]` : ""}: ${l.text}`;
      })
      .join("\n");
  }
}

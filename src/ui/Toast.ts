/** Brief messages above the build bar ("Not enough funds"). */
export class Toast {
  private readonly el = document.createElement('div');
  private timer = 0;

  constructor() {
    this.el.className = 'toast';
    document.body.appendChild(this.el);
  }

  show(message: string, kind: 'info' | 'bad' | 'good' = 'info', ms = 2200) {
    this.el.textContent = message;
    this.el.className = `toast show ${kind}`;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.el.className = 'toast'), ms);
  }

  dispose() {
    clearTimeout(this.timer);
    this.el.remove();
  }
}

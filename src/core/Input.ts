import { Vector2 } from 'three';

export interface ClickEvent {
  /** 0 = left, 1 = middle, 2 = right. */
  button: number;
  x: number;
  y: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface KeyEvent {
  code: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
  preventDefault(): void;
}

/** A press-move-release shorter than this many pixels counts as a click, not a drag. */
const CLICK_SLOP = 4;

/**
 * Central pointer/keyboard state for the game canvas. Drags and clicks are distinguished here so
 * that, for example, a right-button *click* can cancel placement while a right-button *drag*
 * orbits the camera.
 */
export class Input {
  readonly keys = new Set<string>();
  readonly pointer = { x: 0, y: 0, ndc: new Vector2(), overCanvas: false, known: false };
  readonly buttons: [boolean, boolean, boolean] = [false, false, false];
  shift = false;
  ctrl = false;
  alt = false;
  /** Active drag (a button held and moved past the click slop). */
  drag: { button: number; startX: number; startY: number; startNdc: Vector2; moved: boolean } | null = null;

  private wheelAccum = 0;
  private dragDX = 0;
  private dragDY = 0;
  private press: { button: number; x: number; y: number; ndc: Vector2; moved: boolean } | null = null;
  private clickHandlers: Array<(e: ClickEvent) => void> = [];
  private keyHandlers: Array<(e: KeyEvent) => void> = [];
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly el: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn as EventListener);
      this.disposers.push(() => window.removeEventListener(type, fn as EventListener));
    };

    on(el, 'pointerdown', (e) => {
      this.updatePointer(e);
      this.syncModifiers(e);
      if (e.button > 2) return;
      this.buttons[e.button] = true;
      this.press = { button: e.button, x: e.clientX, y: e.clientY, ndc: this.pointer.ndc.clone(), moved: false };
      el.setPointerCapture(e.pointerId);
      el.focus?.();
    });
    on(el, 'pointermove', (e) => {
      const px = this.pointer.x;
      const py = this.pointer.y;
      this.updatePointer(e);
      this.syncModifiers(e);
      const press = this.press;
      if (press) {
        if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) {
          press.moved = true;
          this.drag = { button: press.button, startX: press.x, startY: press.y, startNdc: press.ndc, moved: true };
        }
        if (press.moved) {
          this.dragDX += e.clientX - px;
          this.dragDY += e.clientY - py;
        }
      }
    });
    const release = (e: PointerEvent) => {
      this.syncModifiers(e);
      const press = this.press;
      if (e.button <= 2) this.buttons[e.button] = false;
      if (press && press.button === e.button) {
        if (!press.moved) {
          const ev: ClickEvent = { button: e.button, x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey };
          for (const h of this.clickHandlers) h(ev);
        }
        this.press = null;
        this.drag = null;
      }
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    on(el, 'pointerup', release);
    on(el, 'pointercancel', (e) => {
      this.press = null;
      this.drag = null;
      this.buttons.fill(false);
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    });
    on(el, 'pointerleave', () => {
      this.pointer.overCanvas = false;
    });
    on(el, 'pointerenter', () => {
      this.pointer.overCanvas = true;
    });
    on(el, 'wheel', (e) => {
      e.preventDefault();
      this.syncModifiers(e);
      // Normalise line/page deltas to pixels.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this.wheelAccum += e.deltaY * unit;
    }, { passive: false });
    on(el, 'contextmenu', (e) => e.preventDefault());

    onWin('keydown', (e) => {
      if (isTyping(e.target)) return;
      this.syncModifiers(e);
      this.keys.add(e.code);
      const ev: KeyEvent = { code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, repeat: e.repeat, preventDefault: () => e.preventDefault() };
      for (const h of this.keyHandlers) h(ev);
    });
    onWin('keyup', (e) => {
      this.syncModifiers(e);
      this.keys.delete(e.code);
    });
    onWin('blur', () => {
      this.keys.clear();
      this.buttons.fill(false);
      this.press = null;
      this.drag = null;
    });
  }

  private updatePointer(e: PointerEvent) {
    const rect = this.el.getBoundingClientRect();
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.overCanvas = true;
    this.pointer.known = true;
    this.pointer.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
  }

  private syncModifiers(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }) {
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey;
    this.alt = e.altKey;
  }

  onClick(fn: (e: ClickEvent) => void) {
    this.clickHandlers.push(fn);
    return () => (this.clickHandlers = this.clickHandlers.filter((h) => h !== fn));
  }

  onKey(fn: (e: KeyEvent) => void) {
    this.keyHandlers.push(fn);
    return () => (this.keyHandlers = this.keyHandlers.filter((h) => h !== fn));
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Wheel pixels accumulated since the last call. */
  consumeWheel() {
    const v = this.wheelAccum;
    this.wheelAccum = 0;
    return v;
  }

  /** Pointer movement while dragging, since the last call. */
  consumeDrag() {
    const d = { dx: this.dragDX, dy: this.dragDY };
    this.dragDX = 0;
    this.dragDY = 0;
    return d;
  }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, signal } from '@angular/core';

export interface ContextMenuEntry {
  id: string;
  label: string;
  section: string;
  disabled?: boolean;
  shortcut?: string;
}

@Component({
  selector: 'xds-context-menu',
  standalone: true,
  templateUrl: './context-menu.component.html',
})
export class ContextMenuComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) entries: readonly ContextMenuEntry[] = [];
  @Input({ required: true }) label = '';
  @Input() x = 0;
  @Input() y = 0;
  @Output() readonly action = new EventEmitter<string>();
  @Output() readonly dismiss = new EventEmitter<void>();
  readonly position = signal({ x: 0, y: 0 });
  private previousFocus: HTMLElement | null = null;
  private ready = false;
  private dismissed = false;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.ready = true;
    this.place();
    this.buttons()[0]?.focus();
    if (!this.buttons().length) this.menu()?.focus();
  }

  ngOnChanges(): void {
    if (this.ready) this.place();
  }

  ngOnDestroy(): void {
    const focused = document.activeElement;
    if (focused === document.body || (focused instanceof Node && this.host.nativeElement.contains(focused))) {
      this.previousFocus?.isConnected && this.previousFocus.focus();
    }
  }

  @HostListener('window:resize')
  place(): void {
    const bounds = this.menu()?.getBoundingClientRect();
    const margin = 8;
    this.position.set({
      x: Math.max(margin, Math.min(this.x, window.innerWidth - (bounds?.width ?? 0) - margin)),
      y: Math.max(margin, Math.min(this.y, window.innerHeight - (bounds?.height ?? 0) - margin)),
    });
  }

  activate(entry: ContextMenuEntry): void {
    if (entry.disabled || this.dismissed) return;
    this.action.emit(entry.id);
    this.close();
  }

  close(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.dismiss.emit();
  }

  @HostListener('document:pointerdown', ['$event'])
  @HostListener('document:click', ['$event'])
  outside(event: Event): void {
    if (event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.close();
  }

  @HostListener('keydown', ['$event'])
  key(event: KeyboardEvent): void {
    // Keep editing shortcuts outside the menu from handling its navigation keys.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.close();
      return;
    }
    const buttons = this.buttons();
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  private menu(): HTMLElement | null {
    return this.host.nativeElement.querySelector('[role="menu"]');
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'));
  }
}

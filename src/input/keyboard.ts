// Klávesnicový vstup. Drží set stisknutých kláves a každý frame vrací efektivní pohyb.

export class Keyboard {
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => this.pressed.add(e.code));
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    // Při ztrátě fokusu vyčistíme — jinak by „uvízla" klávesa.
    window.addEventListener('blur', () => this.pressed.clear());
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }
}

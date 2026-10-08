// Builds the single screen and hands back typed references to its parts.

const TEMPLATE = `
<main class="layout">
  <section class="stage">
    <canvas id="preview" width="1296" height="840"></canvas>
    <p id="placeholder" class="placeholder">Conecta el escáner para ver la vista previa.</p>
    <p id="clip-warning" class="warning" hidden>Hay zonas saturadas: baja la exposición.</p>
  </section>

  <aside class="controls">
    <div class="settings">
    <h1>Memor-ease</h1>
    <p id="status" class="status" role="status"></p>
    <p id="message" class="error" hidden></p>
    <button id="connect" type="button">Conectar escáner</button>

    <h2>Destino</h2>
    <button id="folder" type="button">Elegir carpeta</button>
    <p id="folder-name" class="hint"></p>
    <button id="regrant" type="button" hidden>Reactivar permiso de la carpeta</button>
    <label class="field">Rollo
      <input id="roll" type="text" maxlength="40" autocomplete="off" spellcheck="false">
    </label>
    <p id="roll-error" class="error" hidden>Usa letras, números, espacios, guiones o guiones bajos (1 a 40), sin espacios al inicio ni al final.</p>

    <h2>Película</h2>
    <fieldset class="choices">
      <label><input type="radio" name="film" value="color-negative"> Negativo color</label>
      <label><input type="radio" name="film" value="bw-negative"> Negativo B/N</label>
      <label><input type="radio" name="film" value="slide"> Diapositiva</label>
    </fieldset>
    <label class="check"><input id="rotate" type="checkbox"> Rotar 180°</label>
    <label class="check"><input id="mirror" type="checkbox"> Espejo</label>

    <h2>Exposición</h2>
    <label id="exposure-row" class="field"><span>Exposición <output id="exposure-value"></output></span>
      <input id="exposure" type="range" min="-90" max="90" step="5">
    </label>
    <button id="lock" type="button" aria-pressed="false">Fijar exposición y color</button>
    </div>

    <div class="capture-bar">
      <button id="capture" type="button" class="primary">Capturar</button>
      <p class="hint">También con la barra espaciadora o el botón del escáner.</p>
      <p id="next-name" class="hint"></p>
      <button id="undo" type="button">Deshacer última</button>
    </div>
  </aside>

  <section id="strip" class="strip" aria-label="Capturas de esta sesión"></section>
</main>
`;

export interface View {
  status: HTMLElement;
  message: HTMLElement;
  preview: HTMLCanvasElement;
  placeholder: HTMLElement;
  clipWarning: HTMLElement;
  connect: HTMLButtonElement;
  folder: HTMLButtonElement;
  folderName: HTMLElement;
  regrant: HTMLButtonElement;
  roll: HTMLInputElement;
  rollError: HTMLElement;
  film: HTMLInputElement[];
  rotate: HTMLInputElement;
  mirror: HTMLInputElement;
  exposureRow: HTMLElement;
  exposure: HTMLInputElement;
  exposureValue: HTMLElement;
  lock: HTMLButtonElement;
  capture: HTMLButtonElement;
  undo: HTMLButtonElement;
  nextName: HTMLElement;
  strip: HTMLElement;
}

export function createView(root: HTMLElement): View {
  root.innerHTML = TEMPLATE;
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`missing element ${selector}`);
    return element;
  };
  return {
    status: find('#status'),
    message: find('#message'),
    preview: find('#preview'),
    placeholder: find('#placeholder'),
    clipWarning: find('#clip-warning'),
    connect: find('#connect'),
    folder: find('#folder'),
    folderName: find('#folder-name'),
    regrant: find('#regrant'),
    roll: find('#roll'),
    rollError: find('#roll-error'),
    film: [...root.querySelectorAll<HTMLInputElement>('input[name="film"]')],
    rotate: find('#rotate'),
    mirror: find('#mirror'),
    exposureRow: find('#exposure-row'),
    exposure: find('#exposure'),
    exposureValue: find('#exposure-value'),
    lock: find('#lock'),
    capture: find('#capture'),
    undo: find('#undo'),
    nextName: find('#next-name'),
    strip: find('#strip'),
  };
}

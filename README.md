# Memor-ease

App web para escanear película de 35 mm con el Memor-ease CS500 de Pacific Image, sin su software
original. Habla con el escáner por WebUSB, muestra la vista previa ya revelada y guarda cada foto en
una carpeta como JPEG más DNG.

## Requisitos

- Chrome, Edge o Chromium de escritorio. Safari y Firefox no tienen WebUSB; iOS y Android no sirven.
- Node 24 para correr el servidor local.

## Uso

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

1. **Conectar escáner** y elige `USB Camera`.
2. **Elegir carpeta** de destino. Cada rollo se guarda en una subcarpeta con su nombre.
3. Elige el tipo de película y, si hace falta, rota o refleja la imagen.
4. Captura con el botón del escáner, la barra espaciadora o el botón **Capturar**. Avanza la tira y
   repite.

Cada captura produce `<rollo>_<número>.jpg` y `<rollo>_<número>.dng`. El DNG guarda los datos del
sensor sin procesar y se abre en Lightroom, darktable o RawTherapee; un negativo se abre como
negativo y se invierte ahí. El color automático del JPEG es aproximado: para color fino, usa el DNG.

**Deshacer última** borra el par de archivos de la captura más reciente.

## Controles del sensor

- El deslizador de exposición mueve el objetivo de exposición automática del sensor. Verificado en el
  aparato.
- **Fijar exposición y color** congela los niveles del revelado y también la exposición, la ganancia y
  el balance de blancos del sensor. Verificado en el aparato.

Si la vista previa avisa de zonas saturadas, baja la exposición: la base de la película está
quemando el sensor y se pierde detalle en las sombras.

## Calibrar la luz

La lámpara del escáner no ilumina parejo. En el aparato con que se desarrolló esto, el brillo cambia
unos 25 puntos porcentuales de un lado al otro del cuadro y el balance de color cerca de 10 %.

Con el escáner vacío, sin película ni portanegativos, pulsa **Calibrar luz**. La app promedia cuatro
cuadros en blanco, guarda una referencia y a partir de ahí corrige con ella la vista previa y los JPEG.
El DNG conserva los datos del sensor tal cual. La referencia se recuerda entre sesiones; **Quitar
calibración** la descarta.

La corrección es suave a propósito y no quita el polvo: los puntos se limpian con una perilla de aire.

## Problemas conocidos

- **El selector de dispositivos sale vacío.** Si otro programa tocó el escáner mientras el navegador
  lo enumeraba, el navegador lo descarta hasta reiniciarse. Cierra el navegador por completo y
  vuelve a abrirlo.
- **Solo un programa a la vez.** Si la app está abierta en dos pestañas, o corre el arnés de pruebas,
  la segunda no puede conectar.
- **Hay que volver a elegir el escáner** después de reconectarlo o de reiniciar el navegador. El
  aparato no tiene número de serie y el navegador no puede recordar el permiso.
- **La carpeta pide permiso otra vez** al volver a abrir la app. Es un clic en «Reactivar permiso de
  la carpeta».

## Desarrollo

```bash
npm test                 # pruebas unitarias
npm run typecheck
npm run build            # página estática en dist/
npm run hw -- stream     # pruebas con el aparato conectado: stream, sensor, capture, flat, app
```

Las pruebas con el aparato corren la página dentro de Electron, que se concede el permiso USB sin
mostrar el selector. Dejan sus archivos en `tools/hw-harness/out/`. El escenario `flat` necesita el
escáner vacío.

El diseño está en `docs/superpowers/specs/2026-10-07-memorease-webusb-design.md`.

## Créditos y licencia

El protocolo USB, la secuencia de inicialización y las tablas de registros vienen del driver
`gspca/ov534_9.c` del kernel de Linux, de Jean-Francois Moine, Antonio Ospite y Jim Paris.

GPL-2.0-or-later. Ver `LICENSE`.

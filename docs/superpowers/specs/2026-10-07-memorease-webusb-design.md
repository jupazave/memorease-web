# Memor-ease: app web de escaneo por WebUSB

Fecha: 2026-10-07. Estado: diseño aprobado, pendiente de plan de implementación.

## Objetivo

Volver a usar el escáner de película Memor-ease CS500 (Pacific Image) sin su software original, desde
una página web que habla con el aparato por WebUSB. El uso principal es digitalizar **rollos completos**:
capturar, avanzar la tira, capturar, con cada foto guardada sola en una carpeta.

Tipos de película: negativo a color, negativo blanco y negro y diapositivas.

## Lo que ya está verificado

Una prueba desechable (`spike/`, fuera de git) confirmó en esta Mac, con Chromium 147 y con Electron
(Chromium 152):

- El aparato es USB `05a9:1550`, puente OmniVision OV538 con sensor OV5621 (ID de sensor `0x5621`).
- La secuencia de inicialización del driver de Linux `gspca/ov534_9.c` corre sin errores.
- El stream isócrono entrega cuadros de 2592×1680 en Bayer BGGR de 8 bits (4 354 560 bytes), uno cada
  0.49 s aproximadamente, sin encabezados corruptos.
- El botón físico reporta por el endpoint de interrupción.

## Alcance

Dentro de la versión 1:

- Conectar, vista previa en vivo ya revelada, y captura a carpeta con numeración automática.
- Disparo por botón físico, barra espaciadora o botón en pantalla.
- Tres modos de revelado, orientación, control de exposición y bloqueo de ajustes por rollo.
- JPEG más crudo en DNG por cada foto.
- Deshacer la última captura.

Fuera de la versión 1:

- Editor por foto (recorte, limpieza de polvo, color manual fino).
- Volver a revelar archivos DNG dentro de la app.
- Publicar la app en internet. Corre en `localhost`.
- Navegadores sin WebUSB (Safari, Firefox) y dispositivos móviles: iOS no da acceso USB genérico a
  páginas ni a apps, y este aparato no es una cámara UVC estándar.
- Interfaz en otros idiomas. La interfaz va en español.

## Protocolo del dispositivo

Todo lo de esta sección está verificado salvo donde se indica.

**Topología USB.** Configuración 1, interfaz 0, clase `0xFF`.

| Alt | Endpoint 1 IN (isócrono) | Endpoint 3 IN (interrupción) |
|---|---|---|
| 0 | tamaño 0, en reposo | 4 bytes |
| 1 | `wMaxPacketSize = 0x13fc`, 3 × 1020 = 3060 bytes por microtrama | 4 bytes |

Chromium reporta `packetSize = 5116` para ese endpoint, que es el valor crudo sin decodificar. El tamaño
real se calcula leyendo el descriptor de configuración con un `GET_DESCRIPTOR` estándar:
`(w & 0x7ff) * (1 + ((w >> 11) & 3))`.

**Registros del puente.** Transferencia de control de tipo vendor, destinatario device, `bRequest = 0x01`,
`wValue = 0`, `wIndex = registro`, un byte de datos. Lectura y escritura usan la misma forma.

**Registros del sensor (SCCB).** A través del puente:

- Escribir: `0xf2 = subdirección`, `0xf3 = valor`, `0xf5 = 0x37`, y esperar estado.
- Leer: `0xf2 = subdirección`, `0xf5 = 0x33`, esperar estado, `0xf5 = 0xf9`, esperar estado, leer `0xf4`.
- Esperar estado: hasta 5 intentos de dormir 20 ms y leer `0xf6`; `0x00` es éxito, `0x04` es fallo,
  `0x03` es reintentar.

**Inicialización** (unos 2.5 s):

1. Reinicio del puente: `0xe7 = 0x3a`, `0xe0 = 0x08`, esperar 100 ms.
2. Dirección del sensor: `0xf1 = 0x60`.
3. Reinicio del sensor: SCCB `0x12 = 0x80`, esperar 10 ms.
4. Leer el ID en SCCB `0x0a` y `0x0b` (cada uno se lee dos veces y vale la segunda). Debe cumplir
   `(id & 0xfff0) == 0x5620`; si no, es un error de dispositivo no soportado.
5. Tabla del puente `ov562x_init` (13 pares) y tabla del sensor `ov562x_init_2` (99 pares), tal cual
   están en el driver de Linux.
6. `0xe0 = 0x00`.

**Stream.** Seleccionar alt 1 y mantener 6 transferencias isócronas en vuelo, cada una de 32 paquetes de
3060 bytes. Cada paquete recibido se parte en cargas de 2040 bytes como máximo. Cada carga empieza con
un encabezado de 12 bytes:

- Byte 0: longitud del encabezado, siempre 12.
- Byte 1: banderas. `0x40` error, `0x04` trae PTS, `0x02` fin de cuadro, `0x01` FID.
- Bytes 2 a 5: PTS en little endian.

Un cuadro empieza cuando cambia el PTS o el FID y termina con la bandera de fin de cuadro. Las cargas
con encabezado inválido, bandera de error o sin PTS descartan el cuadro en curso. Solo se entregan
cuadros con fin de cuadro y exactamente 4 354 560 bytes.

Para detener: seleccionar alt 0.

**Botón.** El endpoint 3 entrega reportes de 4 bytes. Al arrancar llega `02 01 00 00`. Cada pulsación
produce `82 22 05 44` y unos 65 ms después `8a 22 05 44`. Regla de disparo: un reporte cuyo byte 0
cumple `(b & 0x88) == 0x80`, ignorando disparos a menos de 300 ms del anterior.

**Control del sensor (por verificar en el aparato).** Estos registros vienen del driver de Linux y de
la convención de OmniVision, y no se han probado todavía:

- Objetivo de exposición automática: SCCB `0x24 = 0x76 + n`, `0x25 = 0x6a + n`, y `0x26` igual a `0x71`
  si `n < -40`, `0x94` si `n < 20`, `0xe6` en otro caso, con `n` entre −90 y 90. Es el control de
  brillo de Linux para este sensor.
- Modos automáticos: SCCB `0x13`, que la inicialización deja en `0xc7`. Se asume bit 0 exposición
  automática, bit 1 balance de blancos automático, bit 2 ganancia automática.

La primera tarea de implementación que toque el sensor los verifica con el arnés de hardware:

- El objetivo de exposición funciona si bajar `n` reduce el nivel medio del cuadro crudo.
- El congelado funciona si, con `0x13 = 0xc0`, mover el objetivo de exposición ya no cambia el nivel
  medio y los registros de ganancia de azul y rojo (`0x01` y `0x02`) se quedan fijos.

Si un control no pasa su verificación, se documenta en el README y la app se degrada así, sin que el
resto dependa de él:

- Objetivo de exposición: se quita el deslizador.
- Congelado: **Fijar** congela solo los niveles del revelado.

## Flujo de uso

1. **Conectar escáner.** Clic y elegir `USB Camera` en el selector del navegador. El aparato no tiene
   número de serie, así que el permiso dura mientras siga conectado; tras reconectarlo o reiniciar el
   navegador hay que elegirlo otra vez. Dentro de la misma sesión de conexión, la app reconecta sola al
   recargar.
2. **Carpeta de destino.** Se elige una vez con el selector de carpetas del sistema. La app la recuerda
   entre sesiones; al volver, el navegador exige un clic para reactivar el permiso.
3. **Rollo.** Campo de texto, por defecto `rollo-01`. Define la subcarpeta y el prefijo de los archivos.
4. **Tipo de película.** Negativo color, negativo B/N o diapositiva.
5. **Vista previa en vivo** ya revelada y orientada.
6. **Capturar**, avanzar la tira y repetir.

## Pantalla

Una sola pantalla:

- Vista previa grande a la izquierda, con un aviso cuando el cuadro crudo tiene más de 1 % de píxeles
  saturados en algún canal.
- Columna de controles a la derecha: conectar, carpeta, rollo, tipo de película, rotar 180°, espejo,
  exposición (deslizador de −90 a 90), **Fijar exposición y color**, **Capturar**, **Deshacer última**
  y el nombre del siguiente archivo.
- Tira inferior con las miniaturas de la sesión, la más reciente primero, cada una con su nombre.

Estados de la app: navegador sin WebUSB, desconectado, conectando, en vivo, capturando y error. Capturar
solo se habilita en vivo, con carpeta con permiso de escritura y nombre de rollo válido; fuera de eso,
el botón físico y la barra espaciadora se ignoran.

La barra espaciadora dispara cuando el foco no está en un campo de texto. Tipo de película, orientación,
exposición y nombre de rollo se recuerdan en `localStorage`.

## Captura y archivos

**Cuál cuadro se guarda.** Al disparar se anota el instante. Se guarda el primer cuadro completo cuya
primera carga llegó después de ese instante, para no tomar un cuadro leído mientras la tira se movía.
La latencia queda entre 0.5 y 1 s. Los disparos que llegan con una captura en curso se ignoran.

**Nombres.** Dentro de la carpeta elegida, subcarpeta con el nombre del rollo:

```
<carpeta>/rollo-01/rollo-01_0001.jpg
<carpeta>/rollo-01/rollo-01_0001.dng
```

- El nombre de rollo admite letras, números, espacio, guion y guion bajo, de 1 a 40 caracteres, sin
  espacios al inicio ni al final.
- El número siguiente es el mayor que exista en la subcarpeta más uno, empezando en 1, con cuatro
  dígitos. Se recalcula al conectar la carpeta y al cambiar de rollo. Nunca se sobrescribe un archivo.
- La subcarpeta se crea al guardar la primera foto, no al escribir el nombre del rollo.

**Escritura.** Primero el DNG y luego el JPEG. Si alguno falla, se borra el que sí se escribió, se
muestra el error y el contador no avanza.

**JPEG.** Resolución completa de 2592×1680, calidad 0.92, con el revelado y la orientación aplicados.

**DNG.** Datos del sensor sin tocar, sin compresión, en un TIFF little endian con un solo IFD:

| Etiqueta | Valor |
|---|---|
| NewSubFileType | 0 |
| ImageWidth, ImageLength | 2592, 1680 |
| BitsPerSample, SamplesPerPixel | 8, 1 |
| Compression | 1 |
| PhotometricInterpretation | 32803 (CFA) |
| Make, Model, UniqueCameraModel | `Pacific Image`, `Memor-ease CS500`, `Pacific Image Memor-ease CS500` |
| Software | `memorease` |
| Orientation | 1 normal, 3 rotado 180°, 2 espejo, 4 rotado 180° con espejo |
| StripOffsets, RowsPerStrip, StripByteCounts | una sola tira con los 4 354 560 bytes |
| PlanarConfiguration | 1 |
| CFARepeatPatternDim, CFAPattern | `2 2`, `2 1 1 0` (BGGR) |
| DNGVersion, DNGBackwardVersion | `1.4.0.0`, `1.1.0.0` |
| BlackLevel, WhiteLevel | 0, 255 |
| ColorMatrix1 | matriz XYZ a sRGB con D65 |
| CalibrationIlluminant1 | 21 (D65) |
| AsShotNeutral | `1 1 1` |

El sensor no está caracterizado, así que la matriz de color es una aproximación; un negativo se abre
como negativo y se invierte en el programa de revelado.

**Deshacer.** Borra el par de archivos de la última captura de la sesión y quita su miniatura. Un solo
nivel. El número liberado se reutiliza.

## Revelado

Entrada: mosaico Bayer BGGR de 8 bits. El azul está en fila par y columna par, el rojo en fila impar y
columna impar.

**Demosaico.**

- Vista previa: cada celda de 2×2 da un píxel, con el verde como promedio de los dos. Resultado de
  1296×840.
- Captura: bilineal a resolución completa, reflejando en los bordes para conservar la fase del
  mosaico.

**Niveles.** Por canal se calcula el histograma sobre la imagen de media resolución, ignorando un 5 %
de margen por lado. `lo` es el percentil 0.5 y `hi` el 99.5, con una separación mínima de 8.

**Modos.**

- **Negativo color.** Densidad normalizada por canal: `d = ln(hi / v) / ln(hi / lo)`, recortada a
  0..1. Vale 0 en la base de la película y 1 en la zona más densa, lo que quita la máscara naranja e
  iguala el contraste de las tres capas. La salida es `255 * d ^ TONO`, con `TONO = 1.0`.
- **Negativo B/N.** Igual, pero sobre una sola luminancia `(R + 2G + B) / 4`, con salida gris.
- **Diapositiva.** Sin invertir: `n = (v - lo) / (hi - lo)` por canal y salida `255 * n ^ (1 / 2.2)`.

Los percentiles, el margen y `TONO` son constantes con nombre en un solo módulo. El color automático es
aproximado por diseño; el DNG es el camino para color fino.

**Automático y fijo.** Por defecto los niveles se recalculan en cada cuadro y el sensor ajusta solo
exposición, ganancia y balance de blancos. Ese balance automático no estorba mientras no se fije: la
normalización por canal es inmune a las ganancias por canal, y el balance ayuda a aprovechar el rango
de 8 bits. **Fijar exposición y color** congela los niveles del cuadro actual y apaga los tres modos
automáticos del sensor (`0x13 = 0xc0`), de modo que todo el rollo salga con el mismo tratamiento. Se
suelta con el mismo botón (`0x13 = 0xc7`), o al cambiar de tipo de película. Mientras está fijo, el
deslizador de exposición se deshabilita.

**Exposición.** El deslizador mueve el objetivo de exposición automática. Sirve para bajar la exposición
cuando la base de la película satura: en el cuadro de prueba el rojo saturó en 3.1 % de los píxeles y
el verde en 1.8 %.

**Orientación.** Rotar 180° y espejo horizontal, aplicados al JPEG y a la vista previa. En el DNG van
solo en la etiqueta de orientación.

**Calibración de luz** (agregada el 2026-10-08, tras medir un cuadro en blanco). La lámpara no ilumina
parejo: en una rejilla de 8×6 el brillo va de 87 % a 112 % del promedio y el balance rojo/azul cambia
cerca de 10 % de un lado al otro. Se corrige con una referencia de campo plano:

- **Calibrar luz** se usa con el escáner vacío. Promedia 4 cuadros crudos y guarda, por canal, la
  media de cada celda de una rejilla de 24 píxeles de media resolución (54×35 celdas).
- La ganancia de cada muestra es la celda más tenue de su canal entre el valor interpolado
  bilinealmente en ese punto. Nunca pasa de 1, así que la corrección no puede saturar nada.
- Se aplica al mosaico crudo antes del demosaico, para la vista previa y el JPEG. El DNG no se toca.
  El aviso de saturación se sigue midiendo sobre los datos del sensor sin corregir.
- La referencia se rechaza si casi no hay luz (media de un canal bajo 30), si más de 0.1 % de las
  muestras están saturadas, o si en algún canal la celda más tenue es menos de 0.55 de la más
  brillante. Medido en el aparato: de 0.67 a 0.75 vacío, de 0.19 a 0.46 con un negativo puesto.
- Se guarda en IndexedDB y se recuerda entre sesiones. Calibrar o quitar la calibración suelta
  **Fijar**, porque los niveles fijados ya no corresponden.
- La rejilla es gruesa a propósito: corrige la lámpara sin agregar ruido, y no quita polvo.

## Arquitectura

Página estática en TypeScript con Vite, sin framework de interfaz y sin dependencias en tiempo de
ejecución. Servidor de desarrollo en `http://localhost:5173` con puerto fijo, porque el permiso USB va
ligado al origen.

| Módulo | Responsabilidad | Depende de |
|---|---|---|
| `frame` | Constantes de geometría del cuadro | nada |
| `device/registers` | Lectura y escritura de registros del puente y del sensor | `USBDevice` |
| `device/tables` | Tablas de inicialización | nada |
| `device/frames` | Armado de cuadros a partir de cargas. Lógica pura | `frame` |
| `device/button` | Decodificar reportes del botón. Lógica pura | nada |
| `device/descriptor` | Tamaño real del paquete isócrono a partir del descriptor. Lógica pura | nada |
| `device/sensor-control` | Valores de registro para exposición y congelado. Lógica pura | nada |
| `device/scanner` | Conectar, inicializar, stream, botón, control del sensor. Emite cuadros y pulsaciones | los anteriores |
| `image/demosaic` | Media resolución y bilineal. Lógica pura | nada |
| `image/develop` | Niveles, modos de película, orientación. Lógica pura | nada |
| `image/dng` | Escritor de DNG. Lógica pura | nada |
| `image/flatfield` | Referencia de la lámpara, validación y corrección del mosaico. Lógica pura | nada |
| `image/pipeline` | Encadena demosaico, niveles y revelado para vista previa y captura. Lógica pura | `frame`, `image/*` |
| `image/worker` | Ejecuta el pipeline y la codificación JPEG fuera del hilo principal | `image/*` |
| `image/client` | Interfaz de promesas hacia el worker; descarta vistas previas si está ocupado | `image/worker` |
| `storage/naming` | Validar rollo y calcular el siguiente número. Lógica pura | nada |
| `storage/db` | Almacén clave-valor en IndexedDB para la carpeta y la referencia de la lámpara | nada |
| `storage/folder` | Carpeta persistida, permisos, escribir y borrar | `storage/naming`, `storage/db` |
| `ui/settings` | Ajustes recordados en `localStorage` | `storage/naming` |
| `ui/view` | Construye el DOM de la pantalla | nada |
| `ui/app` | Estado de la pantalla y cableado entre módulos | todos |

**Flujo de datos.** `scanner` entrega cada cuadro como `Uint8Array` con el instante de inicio. `app` lo
transfiere al worker sin copiar. Para la vista previa el worker devuelve un `ImageBitmap` y los niveles
calculados; si el worker sigue ocupado cuando llega otro cuadro, ese cuadro se descarta. Para una
captura devuelve el JPEG, el DNG y una miniatura, y `app` los pasa a `folder`.

## Errores

- **Navegador sin WebUSB:** mensaje fijo que pide Chrome, Edge o Chromium.
- **Sensor inesperado o fallo de inicialización:** estado de error con el detalle y botón de reintentar.
- **Cable desconectado:** se detiene el stream y se pasa a desconectado.
- **Transferencia fallida con el aparato aún conectado:** estado de error con botón de reintentar.
- **Tres segundos sin cuadros completos:** se reinicia el stream una vez (alt 0 y de nuevo alt 1); si
  sigue sin cuadros, estado de error.
- **Carpeta sin permiso:** Capturar se deshabilita y se muestra el botón para reactivar el permiso.
- **Fallo de escritura:** mensaje con el motivo; el contador no avanza y no queda un archivo suelto.

El README documenta un problema conocido: si otro proceso tocó el escáner mientras Chromium lo
enumeraba, el selector sale vacío hasta reiniciar Chromium por completo.

## Pruebas

**Unitarias (Vitest)**, sobre los módulos de lógica pura:

- `frames`: cuadro normal; cambio de PTS sin fin de cuadro; encabezado inválido; bandera de error;
  desbordamiento; paquete de 3060 bytes partido en dos cargas.
- `button`: reportes de arranque, pulsación y rebote.
- `demosaic`: mosaicos sintéticos con resultado conocido en ambos métodos.
- `develop`: percentiles con margen; un gris visto a través de una máscara naranja sintética sale
  neutro en negativo color; la salida es monótona; los tres modos; las cuatro orientaciones.
- `dng`: releer el IFD y comprobar etiquetas, desplazamiento y tamaño de los datos.
- `flatfield`: medias por celda; un cuadro en blanco con gradiente queda parejo tras corregirse con
  su propia referencia; las ganancias nunca pasan de 1; los tres motivos de rechazo.
- `naming`: validación del rollo y siguiente número con carpeta vacía, con huecos y con archivos ajenos.

**Con el aparato.** Un arnés de Electron en `tools/hw-harness/` que se concede el permiso USB sin
selector, carga una página de prueba que usa `device/` e `image/`, y comprueba que llegan cuadros
completos, que el JPEG decodifica y que macOS lee el DNG con `sips`. También sirve para verificar los
controles del sensor. No cubre `storage/` ni `ui/`, porque el selector de carpetas no se puede
automatizar.

**Aceptación manual**, en Chromium: conectar; elegir carpeta; tres capturas con el botón físico; los
archivos existen y están numerados; deshacer borra el último par; al recargar la numeración continúa;
una captura en cada tipo de película.

## Licencia

Las tablas y la secuencia de inicialización derivan de `drivers/media/usb/gspca/ov534_9.c` del kernel de
Linux, con licencia GPL-2.0-or-later. El proyecto adopta esa licencia y los archivos de `device/`
acreditan a sus autores.

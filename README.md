# Cotizador PWA v1

MVP de cotizador con motor determinista basado en `rules.json`.

## Qué hace

- Recibe texto libre.
- Extrae cliente mediante patrones.
- Detecta rubro/trabajo por palabras clave.
- Extrae materiales, mano de obra y total.
- Detecta fechas simples: hoy, mañana, días de semana y dd/mm.
- Detecta recordatorios como "recordame en 3 días".
- Genera una descripción por plantilla.
- Muestra trazabilidad de reglas aplicadas.
- Permite corregir campos antes de guardar.
- Guarda presupuestos en `localStorage`.
- Copia un mensaje listo para enviar.
- Incluye `manifest.webmanifest` y `sw.js` para funcionar como PWA.

## Importante

Abrir `index.html` directamente con `file://` puede impedir que JavaScript cargue `rules.json`.
Serví la carpeta por HTTP/HTTPS.

Opciones rápidas:

### En PC
```bash
python -m http.server 8080
```

Luego abrí `http://localhost:8080`.

### En Android
Podés usar cualquier servidor HTTP local o subir esta carpeta a un hosting estático (GitHub Pages, Netlify, Cloudflare Pages, etc.).

## Arquitectura

`rules.json` contiene conocimiento declarativo.
`app.js` contiene el motor genérico que:

1. normaliza,
2. aplica expresiones regulares,
3. clasifica por palabras clave,
4. resuelve fechas,
5. produce un objeto estructurado,
6. conserva una traza de las reglas que dispararon.

La idea es que agregar un rubro nuevo no requiera reescribir toda la interfaz.

## Limitación de alertas

Esta versión guarda la fecha/hora del recordatorio, pero no programa una notificación del sistema cuando la app está cerrada.
En una PWA Android, las notificaciones programadas de forma fiable normalmente requieren push/backend o una estrategia adicional.

## Próximos pasos lógicos

- Separar "conceptos" del presupuesto en múltiples líneas.
- Agregar reglas de unidades, cantidades y medidas.
- Detectar más de un material.
- Validez del presupuesto.
- Números de presupuesto.
- Exportación a PDF.
- Compartir directamente por WhatsApp.
- Persistencia con IndexedDB.
- Push para recordatorios reales.
- Editor visual de `rules.json`.

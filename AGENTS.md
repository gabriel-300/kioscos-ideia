<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Documentación del proyecto

Antes de tocar código, leé `docs/architecture.md` (cómo está construido y las trampas conocidas) y `docs/requirements.md` (qué hace cada módulo y qué decisiones de negocio NO se corrigen sin preguntar). Para entender la base de datos (qué es cada tabla y columna, columnas heredadas que no se usan): `docs/base-de-datos.md`.

**Mantenimiento:** cuando un cambio sea estructural (migración nueva, rol o guarda nuevos, módulo o integración, cambio de despliegue o de un flujo de dinero) o cierre o abra un hallazgo de la auditoría, actualizá el documento que corresponda en el mismo commit. Si la migración cambia tablas o columnas, refrescá `scripts/mapa-base/catalog.json` (consulta en `scripts/mapa-base/consultas.sql`), describí lo nuevo en `scripts/mapa-base/descripciones.js` y regenerá con `node scripts/mapa-base/generar.js`. Si el documento contradice al código, gana el código: corregí el documento.

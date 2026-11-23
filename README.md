# Pruebas automatizadas de SisteAcuse

Proyecto final de **Construcción de Software y Pruebas** (Pontificia Universidad Javeriana Cali, 2026-2).

SisteAcuse es una plataforma web para causar los eventos RADIAN de la factura electrónica en Colombia. Este repositorio contiene **solo el código bajo prueba** (copiado de los repositorios de SisteAcuse, ver `sut/ORIGEN.txt`) y las pruebas automatizadas.

## Funcionalidades bajo prueba

| ID | Funcionalidad | Código bajo prueba | Nivel |
|----|---------------|--------------------|-------|
| F1 | Validación del NIT y cálculo del dígito de verificación | `sut/app/rut/nit.ts` | Unitaria |
| F2 | Calendario tributario: festivos, días hábiles y vencimientos por último dígito del NIT | `sut/app/calendario/` | Unitaria + oráculo |
| F3 | Cotización de planes: `cotizar()` (registro, compra, upgrade, adicionales, renovación), cupón, prorrateo, control del monto y fecha de corte | `sut/sitio-pagos/pagos.ts` y `/planes` | Unitaria + E2E |
| F4 | Registro con compra del plan (datos, cupón y pago) | `sut/sitio/` (sitio compilado) | E2E |

## Cómo correrlas

```bash
npm ci
npx playwright install chromium webkit   # solo la primera vez

npm run test:unit        # unitarias (Vitest)
npm run test:cobertura   # unitarias + cobertura de código
npm run test:e2e         # E2E (Playwright): escritorio y iPhone
npm test                 # todo
npm run cobertura:f3     # cobertura de las funciones del cotizador (F3), por función (criterio S3)
npm run test:mutacion    # pruebas de mutación con Stryker (criterio S5)
npm run test:mutantes    # mutantes dirigidos sobre literales numéricos (complemento de Stryker)
```

Reportes que se generan en `reportes/`:

- `reportes/unitarias/index.html`: resultado de las pruebas unitarias (`npx vite preview --outDir reportes/unitarias`).
- `reportes/cobertura/index.html`: cobertura de líneas y ramas del código bajo prueba.
- `reportes/e2e/index.html`: reporte de Playwright con capturas, y traza y video de los fallos (`npm run reporte:e2e`).
- `reportes/mutacion/index.html`: reporte de Stryker, mutante por mutante; `reportes/mutacion/resumen.json` cruza los sobrevivientes con la revisión de `tests/mutacion/clasificacion.json`.
- `reportes/**/junit.xml`: para la integración continua.

## Entorno de las pruebas E2E

Las pruebas **nunca** tocan producción, la DIAN ni la pasarela de pagos:

- El sitio se compiló con `VITE_SUPABASE_URL=http://supabase.prueba.local`, un host que no existe. Un doble de prueba (`tests/e2e/entorno.ts`) responde en su lugar y registra lo que el sitio envía. En `preparar-pago`, el monto y la validez del cupón salen de las funciones reales del servidor (`cotizar()`, `normalizarCupon()`, `evaluarCupon()`); se simulan la tabla de cupones y sus usos, la firma, la verificación de «ya tiene cuenta» y la tabla `checkouts`.
- El reloj del navegador se fija en el instante que necesita cada prueba, y los montos esperados salen del catálogo vigente en esa fecha.
- Wompi se reemplaza por un widget falso que no cobra y devuelve el estado que pida cada prueba (`APPROVED`, `DECLINED`, …).
- Cualquier otra petición externa (analítica, Meta, YouTube) se bloquea.

## Pruebas de mutación

Stryker genera los mutantes solo (`stryker.config.json`), sobre las funciones en alcance de F1, F2 y F3. Los que sobreviven se revisaron uno por uno: o se escribió la prueba que faltaba, o quedaron justificados uno por uno (archivo, línea, columna, operador y reemplazo) en `tests/mutacion/clasificacion.json` como equivalentes: cambian el código pero no el resultado. `scripts/mutacion-resumen.mjs` falla si aparece un sobreviviente sin prueba ni justificación.

## Defectos encontrados

`tests/unit/defectos.test.ts` documenta cinco defectos (DEF-01 a DEF-05) y `tests/e2e/registro.spec.ts` dos más encontrados en la interfaz (DEF-06: un pago pendiente se puede pagar otra vez; DEF-07: el botón de WhatsApp tapa el total a pagar en escritorio) como pruebas de caracterización: fijan el valor exacto que devuelve hoy el código y su nombre dice cuál sería el correcto. Pasan mientras el defecto exista y fallan el día que se corrija.

## Integración continua

`.github/workflows/pruebas.yml` corre, en cada *push*, la verificación de tipos, las pruebas unitarias con cobertura, el criterio de cobertura S3, las pruebas de mutación (criterio S5) y las E2E. Al final publica la carpeta `reportes/` como artefacto.

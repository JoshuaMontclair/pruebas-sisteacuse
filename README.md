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
npm run cobertura:f3     # cobertura de las funciones del cotizador (F3), por función
npm run test:mutantes    # pruebas de mutación: ¿la suite detecta errores reales?
```

Reportes que se generan en `reportes/`:

- `reportes/unitarias/index.html`: resultado de las pruebas unitarias (`npx vite preview --outDir reportes/unitarias`).
- `reportes/cobertura/index.html`: cobertura de líneas y ramas del código bajo prueba.
- `reportes/e2e/index.html`: reporte de Playwright con capturas, y traza y video de los fallos (`npm run reporte:e2e`).
- `reportes/**/junit.xml`: para la integración continua.

## Entorno de las pruebas E2E

Las pruebas **nunca** tocan producción, la DIAN ni la pasarela de pagos:

- El sitio se compiló con `VITE_SUPABASE_URL=http://supabase.prueba.local`, un host que no existe. Un doble de prueba (`tests/e2e/entorno.ts`) responde en su lugar y registra lo que el sitio envía. El doble de `preparar-pago` cotiza con `cotizar()`, la misma función del servidor; solo se simulan la tabla de cupones y la firma.
- El reloj del navegador se fija en el instante que necesita cada prueba, y los montos esperados salen del catálogo vigente en esa fecha.
- Wompi se reemplaza por un widget falso que no cobra y devuelve el estado que pida cada prueba (`APPROVED`, `DECLINED`, …).
- Cualquier otra petición externa (analítica, Meta, YouTube) se bloquea.

## Defectos encontrados

`tests/unit/defectos.test.ts` documenta cuatro defectos (DEF-01 a DEF-04) como pruebas de caracterización: fijan el valor exacto que devuelve hoy el código y su nombre dice cuál sería el correcto. Pasan mientras el defecto exista y fallan el día que se corrija.

## Integración continua

`.github/workflows/pruebas.yml` corre, en cada *push*, la verificación de tipos, las pruebas unitarias con cobertura y las E2E. Al final publica la carpeta `reportes/` como artefacto.

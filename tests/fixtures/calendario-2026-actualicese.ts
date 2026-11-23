/**
 * DATOS DE PRUEBA — no los usa la app.
 *
 * Tabla 2026 tal como se copió a mano del PDF de Actualícese (lo que la app
 * mostraba hasta octubre de 2026). `scripts/test-calendario.mjs` exige que las
 * reglas de `src/lib/calendario/plazos.ts` den exactamente estas fechas: es la
 * prueba de que el motor interpreta bien el Decreto 2229 de 2023.
 *
 * Calendario tributario 2026 (año gravable 2025) - Decreto 2229 de 2023.
 * Fuente: PDF de Actualícese actualizado el 2025-12-31 (fechas reales, no generadas).
 * https://cdn.actualicese.com/herramientas/calendario-tributario-2026.pdf
 * Si hay discrepancia, prevalecen las fechas publicadas por la DIAN.
 *
 * Nota: los vencimientos del Régimen Simple (anticipos bimestrales) tienen los meses
 * inferidos de un encabezado mal extraído del PDF; conviene confirmarlos.
 * Fuera de este módulo (no incluidos): prestadores de servicios del exterior (IVA),
 * impuesto al patrimonio, productos plásticos de un solo uso, presencia económica
 * significativa y activos en el exterior.
 */

export type TipoDigito = 'ultimo1' | 'ultimo2';

export interface Vencimiento {
  digito: string;
  fecha: string; // YYYY-MM-DD
}

export interface Periodo {
  nombre: string;
  vencimientos: Vencimiento[];
}

export interface Obligacion {
  id: string;
  nombre: string;
  nombreCorto: string;
  frecuencia: string;
  descripcion: string;
  color: string; // Tailwind color class for the badge
  tipoDigito: TipoDigito;
  periodos: Periodo[];
}

// ---------------------------------------------------------------------------
// Constructores de datos (las tablas se declaran tal cual vienen del decreto)
// ---------------------------------------------------------------------------

/** Orden de dígitos de las tablas del decreto: 1,2,...,9,0 */
const DIGITOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (anio: number, mes: number, dia: number) => `${anio}-${pad(mes)}-${pad(dia)}`;

interface ColMes {
  nombre: string;
  anio: number;
  mes: number;
}

/**
 * Construye periodos a partir de una tabla [dígito][columna] con el día del mes.
 * filas[i] corresponde al dígito DIGITOS[i].
 */
function periodosPorMes(columnas: ColMes[], filas: number[][]): Periodo[] {
  return columnas.map((col, c) => ({
    nombre: col.nombre,
    vencimientos: DIGITOS.map((d, i) => ({
      digito: d,
      fecha: iso(col.anio, col.mes, filas[i][c]),
    })),
  }));
}

/** Construye un periodo con una fecha completa por dígito (orden 1..9,0). */
function periodoFechas(nombre: string, fechas: string[]): Periodo {
  return {
    nombre,
    vencimientos: DIGITOS.map((d, i) => ({ digito: d, fecha: fechas[i] })),
  };
}

/** Construye un periodo con fechas por grupos de dígitos (ej. ['1','2'] comparten fecha). */
function periodoGrupos(nombre: string, grupos: [string[], string][]): Periodo {
  const vencimientos: Vencimiento[] = [];
  for (const [digitos, fecha] of grupos) {
    for (const d of digitos) vencimientos.push({ digito: d, fecha });
  }
  return { nombre, vencimientos };
}

// ---------------------------------------------------------------------------
// 1. Retención en la fuente (mensual)
// ---------------------------------------------------------------------------

const RETENCION_COLS: ColMes[] = [
  { nombre: 'Enero 2026 (vence en febrero)', anio: 2026, mes: 2 },
  { nombre: 'Febrero 2026 (vence en marzo)', anio: 2026, mes: 3 },
  { nombre: 'Marzo 2026 (vence en abril)', anio: 2026, mes: 4 },
  { nombre: 'Abril 2026 (vence en mayo)', anio: 2026, mes: 5 },
  { nombre: 'Mayo 2026 (vence en junio)', anio: 2026, mes: 6 },
  { nombre: 'Junio 2026 (vence en julio)', anio: 2026, mes: 7 },
  { nombre: 'Julio 2026 (vence en agosto)', anio: 2026, mes: 8 },
  { nombre: 'Agosto 2026 (vence en septiembre)', anio: 2026, mes: 9 },
  { nombre: 'Septiembre 2026 (vence en octubre)', anio: 2026, mes: 10 },
  { nombre: 'Octubre 2026 (vence en noviembre)', anio: 2026, mes: 11 },
  { nombre: 'Noviembre 2026 (vence en diciembre)', anio: 2026, mes: 12 },
  { nombre: 'Diciembre 2026 (vence en enero 2027)', anio: 2027, mes: 1 },
];

// Filas: dígito 1,2,3,4,5,6,7,8,9,0 - columnas: Ene..Dic
const RETENCION_FILAS: number[][] = [
  [10, 10, 13, 12, 10, 9, 12, 9, 9, 11, 10, 13], // 1
  [11, 11, 14, 13, 11, 10, 13, 10, 13, 12, 11, 14], // 2
  [12, 12, 15, 14, 12, 13, 14, 11, 14, 13, 14, 15], // 3
  [13, 13, 16, 15, 16, 14, 18, 14, 15, 17, 15, 18], // 4
  [16, 16, 17, 19, 17, 15, 19, 15, 16, 18, 16, 19], // 5
  [17, 17, 20, 20, 18, 16, 20, 16, 19, 19, 17, 20], // 6
  [18, 18, 21, 21, 19, 17, 21, 17, 20, 20, 18, 21], // 7
  [19, 19, 22, 22, 22, 21, 24, 18, 21, 23, 21, 22], // 8
  [20, 20, 23, 25, 23, 22, 25, 21, 22, 24, 22, 25], // 9
  [23, 24, 24, 26, 24, 23, 26, 22, 23, 25, 23, 26], // 0
];

// ---------------------------------------------------------------------------
// 2. IVA bimestral
// ---------------------------------------------------------------------------

const IVA_BIM_COLS: ColMes[] = [
  { nombre: 'Enero-Febrero 2026 (vence en marzo)', anio: 2026, mes: 3 },
  { nombre: 'Marzo-Abril 2026 (vence en mayo)', anio: 2026, mes: 5 },
  { nombre: 'Mayo-Junio 2026 (vence en julio)', anio: 2026, mes: 7 },
  { nombre: 'Julio-Agosto 2026 (vence en septiembre)', anio: 2026, mes: 9 },
  { nombre: 'Septiembre-Octubre 2026 (vence en noviembre)', anio: 2026, mes: 11 },
  { nombre: 'Noviembre-Diciembre 2026 (vence en enero 2027)', anio: 2027, mes: 1 },
];

const IVA_BIM_FILAS: number[][] = [
  [10, 12, 9, 9, 11, 13], // 1
  [11, 13, 10, 10, 12, 14], // 2
  [12, 14, 13, 11, 13, 15], // 3
  [13, 15, 14, 14, 17, 18], // 4
  [16, 19, 15, 15, 18, 19], // 5
  [17, 20, 16, 16, 19, 20], // 6
  [18, 21, 17, 17, 20, 21], // 7
  [19, 22, 21, 18, 23, 22], // 8
  [20, 25, 22, 21, 24, 25], // 9
  [24, 26, 23, 22, 25, 26], // 0
];

// ---------------------------------------------------------------------------
// 3. IVA cuatrimestral
// ---------------------------------------------------------------------------

const IVA_CUATRI_COLS: ColMes[] = [
  { nombre: 'Enero-Abril 2026 (vence en mayo)', anio: 2026, mes: 5 },
  { nombre: 'Mayo-Agosto 2026 (vence en septiembre)', anio: 2026, mes: 9 },
  { nombre: 'Septiembre-Diciembre 2026 (vence en enero 2027)', anio: 2027, mes: 1 },
];

const IVA_CUATRI_FILAS: number[][] = [
  [12, 9, 13], // 1
  [13, 10, 14], // 2
  [14, 11, 15], // 3
  [15, 14, 18], // 4
  [19, 15, 19], // 5
  [20, 16, 20], // 6
  [21, 17, 21], // 7
  [22, 18, 22], // 8
  [25, 21, 25], // 9
  [26, 22, 26], // 0
];

// ---------------------------------------------------------------------------
// 4. Renta personas jurídicas y demás
// ---------------------------------------------------------------------------

const RENTA_JUR_C1 = [
  '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-19',
  '2026-05-20', '2026-05-21', '2026-05-22', '2026-05-25', '2026-05-26',
];
const RENTA_JUR_C2 = [
  '2026-07-09', '2026-07-10', '2026-07-13', '2026-07-14', '2026-07-15',
  '2026-07-16', '2026-07-17', '2026-07-21', '2026-07-22', '2026-07-23',
];

// ---------------------------------------------------------------------------
// 5. Renta grandes contribuyentes
// ---------------------------------------------------------------------------

const GRANDES_C1 = [
  '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-16',
  '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
];
const GRANDES_C2 = [
  '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
  '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24',
];
const GRANDES_C3 = [
  '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-16', '2026-06-17',
  '2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23', '2026-06-24',
];

// ---------------------------------------------------------------------------
// 6. Renta personas naturales (dos últimos dígitos del NIT)
// ---------------------------------------------------------------------------

// [primer par, segundo par, fecha]. Cada par comparte fecha.
const RENTA_NATURALES_PARES: [string, string, string][] = [
  ['01', '02', '2026-08-12'], ['03', '04', '2026-08-13'], ['05', '06', '2026-08-14'],
  ['07', '08', '2026-08-18'], ['09', '10', '2026-08-19'], ['11', '12', '2026-08-20'],
  ['13', '14', '2026-08-21'], ['15', '16', '2026-08-24'], ['17', '18', '2026-08-25'],
  ['19', '20', '2026-08-26'], ['21', '22', '2026-08-27'], ['23', '24', '2026-08-28'],
  ['25', '26', '2026-08-31'], ['27', '28', '2026-09-01'], ['29', '30', '2026-09-02'],
  ['31', '32', '2026-09-03'], ['33', '34', '2026-09-04'], ['35', '36', '2026-09-07'],
  ['37', '38', '2026-09-08'], ['39', '40', '2026-09-09'], ['41', '42', '2026-09-10'],
  ['43', '44', '2026-09-11'], ['45', '46', '2026-09-14'], ['47', '48', '2026-09-15'],
  ['49', '50', '2026-09-16'], ['51', '52', '2026-09-17'], ['53', '54', '2026-09-18'],
  ['55', '56', '2026-09-21'], ['57', '58', '2026-09-22'], ['59', '60', '2026-09-23'],
  ['61', '62', '2026-09-24'], ['63', '64', '2026-09-25'], ['65', '66', '2026-09-28'],
  ['67', '68', '2026-10-01'], ['69', '70', '2026-10-02'], ['71', '72', '2026-10-05'],
  ['73', '74', '2026-10-06'], ['75', '76', '2026-10-07'], ['77', '78', '2026-10-08'],
  ['79', '80', '2026-10-09'], ['81', '82', '2026-10-13'], ['83', '84', '2026-10-14'],
  ['85', '86', '2026-10-15'], ['87', '88', '2026-10-16'], ['89', '90', '2026-10-19'],
  ['91', '92', '2026-10-20'], ['93', '94', '2026-10-21'], ['95', '96', '2026-10-22'],
  ['97', '98', '2026-10-23'], ['99', '00', '2026-10-26'],
];

// ---------------------------------------------------------------------------
// 7. Régimen Simple de Tributación
// ---------------------------------------------------------------------------

const SIMPLE_ANTICIPO_COLS: ColMes[] = [
  { nombre: 'Anticipo enero-febrero (vence en mayo)', anio: 2026, mes: 5 },
  { nombre: 'Anticipo marzo-abril (vence en junio)', anio: 2026, mes: 6 },
  { nombre: 'Anticipo mayo-junio (vence en julio)', anio: 2026, mes: 7 },
  { nombre: 'Anticipo julio-agosto (vence en septiembre)', anio: 2026, mes: 9 },
  { nombre: 'Anticipo septiembre-octubre (vence en noviembre)', anio: 2026, mes: 11 },
  { nombre: 'Anticipo noviembre-diciembre (vence en enero 2027)', anio: 2027, mes: 1 },
];

const SIMPLE_ANTICIPO_FILAS: number[][] = [
  [12, 10, 9, 9, 11, 13], // 1
  [13, 11, 10, 10, 12, 14], // 2
  [14, 12, 13, 11, 13, 15], // 3
  [15, 16, 14, 14, 17, 18], // 4
  [19, 17, 15, 15, 18, 19], // 5
  [20, 18, 16, 16, 19, 20], // 6
  [21, 19, 17, 17, 20, 21], // 7
  [22, 22, 21, 18, 23, 22], // 8
  [25, 23, 22, 21, 24, 25], // 9
  [26, 24, 23, 22, 25, 26], // 0
];

// ---------------------------------------------------------------------------
// Catálogo de obligaciones
// ---------------------------------------------------------------------------

export const OBLIGACIONES_2026: Obligacion[] = [
  {
    id: 'retencion',
    nombre: 'Retención en la fuente',
    nombreCorto: 'Retención',
    frecuencia: 'Mensual',
    descripcion:
      'Declaración y pago mensual de retención en la fuente. Aplica también para autorretención, impuesto de timbre e IVA retenido.',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
    tipoDigito: 'ultimo1',
    periodos: periodosPorMes(RETENCION_COLS, RETENCION_FILAS),
  },
  {
    id: 'iva-bimestral',
    nombre: 'IVA bimestral',
    nombreCorto: 'IVA bim.',
    frecuencia: 'Bimestral',
    descripcion:
      'Para responsables de IVA con ingresos brutos de 2025 iguales o superiores a 92.000 UVT. También aplica al impuesto nacional al consumo (INC).',
    color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
    tipoDigito: 'ultimo1',
    periodos: periodosPorMes(IVA_BIM_COLS, IVA_BIM_FILAS),
  },
  {
    id: 'iva-cuatrimestral',
    nombre: 'IVA cuatrimestral',
    nombreCorto: 'IVA cuatri.',
    frecuencia: 'Cuatrimestral',
    descripcion:
      'Para responsables de IVA con ingresos brutos de 2025 inferiores a 92.000 UVT.',
    color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
    tipoDigito: 'ultimo1',
    periodos: periodosPorMes(IVA_CUATRI_COLS, IVA_CUATRI_FILAS),
  },
  {
    id: 'renta-juridicas',
    nombre: 'Renta personas jurídicas y demás',
    nombreCorto: 'Renta jurídicas',
    frecuencia: 'Anual (2 cuotas)',
    descripcion:
      'Año gravable 2025. La cuota 1 es declaración y pago; la cuota 2 es solo pago. Si el saldo a pagar es menor a 41 UVT ($2.147.000), el pago vence en la fecha de la cuota 1. Quienes soliciten obras por impuestos tienen plazo hasta el 2026-05-29.',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    tipoDigito: 'ultimo1',
    periodos: [
      periodoFechas('Cuota 1 (declaración y pago)', RENTA_JUR_C1),
      periodoFechas('Cuota 2 (solo pago)', RENTA_JUR_C2),
    ],
  },
  {
    id: 'renta-grandes',
    nombre: 'Renta grandes contribuyentes',
    nombreCorto: 'Renta grandes',
    frecuencia: 'Anual (3 cuotas)',
    descripcion:
      'Año gravable 2025. Cuota 1 solo pago; cuota 2 declaración y pago (y anticipo cuota 1 de puntos adicionales); cuota 3 solo pago (y anticipo cuota 2 de puntos adicionales).',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    tipoDigito: 'ultimo1',
    periodos: [
      periodoFechas('Cuota 1 (solo pago)', GRANDES_C1),
      periodoFechas('Cuota 2 (declaración y pago)', GRANDES_C2),
      periodoFechas('Cuota 3 (solo pago)', GRANDES_C3),
    ],
  },
  {
    id: 'renta-naturales',
    nombre: 'Renta personas naturales',
    nombreCorto: 'Renta naturales',
    frecuencia: 'Anual',
    descripcion:
      'Año gravable 2025. La fecha depende de los dos últimos dígitos del NIT o cédula; cada par de números comparte fecha.',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
    tipoDigito: 'ultimo2',
    periodos: [
      {
        nombre: 'Declaración y pago año gravable 2025',
        vencimientos: RENTA_NATURALES_PARES.flatMap(([a, b, fecha]) => [
          { digito: a, fecha },
          { digito: b, fecha },
        ]),
      },
    ],
  },
  {
    id: 'regimen-simple',
    nombre: 'Régimen Simple de Tributación',
    nombreCorto: 'Simple',
    frecuencia: 'Bimestral y anual',
    descripcion:
      'Anticipos bimestrales, declaración anual consolidada e IVA anual consolidado del Simple. Las personas naturales del Simple con ingresos de hasta 3.500 UVT no pagan anticipos, solo la declaración anual. Los meses de los anticipos se infirieron del PDF fuente y conviene confirmarlos.',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    tipoDigito: 'ultimo1',
    periodos: [
      ...periodosPorMes(SIMPLE_ANTICIPO_COLS, SIMPLE_ANTICIPO_FILAS),
      periodoGrupos('IVA anual consolidado del Simple (año gravable 2025)', [
        [['1', '2'], '2026-02-16'],
        [['3', '4'], '2026-02-17'],
        [['5', '6'], '2026-02-18'],
        [['7', '8'], '2026-02-19'],
        [['9', '0'], '2026-02-20'],
      ]),
      periodoGrupos('Declaración anual del Simple (año gravable 2025)', [
        [['1', '2'], '2026-04-17'],
        [['3', '4'], '2026-04-20'],
        [['5', '6'], '2026-04-21'],
        [['7', '8'], '2026-04-22'],
        [['9', '0'], '2026-04-23'],
      ]),
    ],
  },
];

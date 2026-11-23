/**
 * Fuente de verdad del COBRO de SisteAcuse: catálogo, reglas de empresas,
 * cupones, prorrateo, gramática de referencias y firma de integridad de Wompi.
 *
 * La usan preparar-pago (cotiza y firma), wompi-webhook (recalcula el monto
 * esperado a partir de la referencia) y create-subscription (flujo gratis).
 * src/lib/pricing.ts del sitio y upgrade.ts de la app quedan solo para MOSTRAR
 * precios; pagos_test.ts verifica que el catálogo del sitio coincide con este.
 *
 * Todo es puro salvo validarCupon(), registrarCanje(), registrarPreparado(),
 * leerPreparado() y leerLicencia(), que reciben `admin` (cliente con service
 * role). El reloj siempre entra por parámetro.
 *
 * wompi-webhook lo importa de forma ESTÁTICA a propósito: si un despliegue lo
 * deja por fuera, la función no arranca y Wompi reintenta (fallo visible). Al
 * desplegar con la herramienta MCP, sube "_shared/pagos.ts" junto al
 * entrypoint "<funcion>/index.ts".
 */

// ── Catálogo ────────────────────────────────────────────────────────────
//
// DOS catálogos, gobernados por FECHA (decisión del dueño, 2026-10-09):
//   · hasta el 31-oct-2026 (hora de Colombia): Pyme 150k/1, Contador 250k/10,
//     Pro 350k/20, Max 550k/50, empresa adicional 50k;
//   · desde el 1-nov-2026 00:00 (Colombia): Pyme 200k/1, Contador 350k/5,
//     Pro 450k/10, Max 750k/20, Ultra 1,4M/50, empresa adicional 75k. Envíos
//     ilimitados en todos. Ultra se compra en línea como los demás; para más de
//     50 empresas el sitio ofrece un contacto, no un plan en línea.
// Qué catálogo usa cada flujo:
//   · registro y compra: el del INSTANTE en que el servidor cotizó y firmó (la
//     marca de tiempo de la referencia), así un pago firmado el 31-oct a las
//     11:59 p. m. y aprobado el 1-nov se aplica con lo que se cobró;
//   · upgrade y empresas adicionales: el del PERIODO pagado de la licencia
//     (catalogoDeLicencia): mientras un cliente actual no renueve, conserva su
//     cupo y paga la empresa adicional a 50k;
//   · renovación: antes del corte, la regla de siempre (mismo plan y cupo);
//     desde el corte la cotiza la base (public.licencia_cotizar_renovacion,
//     precio de fundador por pasos para los clientes actuales).
// src/lib/pricing.ts del sitio y src/lib/api/upgrade.ts de la app tienen el
// mismo par de catálogos para MOSTRAR; pagos_test.ts exige que coincidan.

/** Planes que se compran en línea (registro, compra, upgrade). */
export const CODIGOS_PLAN = ['PYME', 'CONT', 'PRO', 'MAX', 'ULTRA'] as const;
export type CodigoPlan = (typeof CODIGOS_PLAN)[number];

/**
 * Ultra: el plan tope (hasta 50 empresas, $1.400.000/año). Desde el 1-nov-2026
 * SE COMPRA EN LÍNEA como cualquier otro (por eso está en CODIGOS_PLAN).
 * CODIGO_ULTRA y CodigoPlanRenovacion se conservan: la gramática de referencias
 * y la renovación (que admite ULTRA como destino) los siguen usando. Como ULTRA
 * ya está en CODIGOS_PLAN, CODIGOS_PLAN_RENOVACION coincide con él.
 */
export const CODIGO_ULTRA = 'ULTRA' as const;
export type CodigoPlanRenovacion = CodigoPlan | typeof CODIGO_ULTRA;
export const CODIGOS_PLAN_RENOVACION: readonly CodigoPlanRenovacion[] = CODIGOS_PLAN;

/** Nombre (licenses.license_type) de cada plan. Igual en los dos catálogos. */
export const NOMBRE_PLAN: Record<CodigoPlanRenovacion, string> = {
	PYME: 'Plan Pyme',
	CONT: 'Plan Contador',
	PRO: 'Plan Contador Pro',
	MAX: 'Plan Contador Max',
	ULTRA: 'Plan Contador Ultra',
};

export interface PlanCatalogo {
	nombre: string;
	precio: number;
	empresas: number;
}

export interface Catalogo {
	/** 'base-2026' hasta el 31-oct-2026; 'nov-2026' desde el 1-nov-2026. */
	id: 'base-2026' | 'nov-2026';
	planes: Record<CodigoPlan, PlanCatalogo>;
	/** Precio anual (COP) de cada empresa adicional (solo Plan Pyme). */
	empresaAdicional: number;
}

/** 2026-11-01 00:00 en Colombia (UTC−5, sin horario de verano) = 05:00 UTC. */
export const CORTE_PRECIOS_MS = Date.UTC(2026, 10, 1, 5, 0, 0);
/** El mismo corte como fecha de calendario de Colombia. */
export const FECHA_CORTE_PRECIOS = '2026-11-01';

export const CATALOGO_BASE_2026: Catalogo = {
	id: 'base-2026',
	planes: {
		PYME: { nombre: 'Plan Pyme', precio: 150_000, empresas: 1 },
		CONT: { nombre: 'Plan Contador', precio: 250_000, empresas: 10 },
		PRO: { nombre: 'Plan Contador Pro', precio: 350_000, empresas: 20 },
		MAX: { nombre: 'Plan Contador Max', precio: 550_000, empresas: 50 },
		ULTRA: { nombre: 'Plan Contador Ultra', precio: 1_400_000, empresas: 50 },
	},
	empresaAdicional: 50_000,
};

export const CATALOGO_NOV_2026: Catalogo = {
	id: 'nov-2026',
	planes: {
		PYME: { nombre: 'Plan Pyme', precio: 200_000, empresas: 1 },
		CONT: { nombre: 'Plan Contador', precio: 350_000, empresas: 5 },
		PRO: { nombre: 'Plan Contador Pro', precio: 450_000, empresas: 10 },
		MAX: { nombre: 'Plan Contador Max', precio: 750_000, empresas: 20 },
		ULTRA: { nombre: 'Plan Contador Ultra', precio: 1_400_000, empresas: 50 },
	},
	empresaAdicional: 75_000,
};

/** ¿Rigen los precios de noviembre de 2026 en este instante? */
export function rigePrecioNuevo(instante: Date | number): boolean {
	const t = typeof instante === 'number' ? instante : instante.getTime();
	return Number.isFinite(t) && t >= CORTE_PRECIOS_MS;
}

/** Catálogo vigente en un instante (el de la cotización, nunca el del navegador). */
export function catalogoEn(instante: Date | number): Catalogo {
	return rigePrecioNuevo(instante) ? CATALOGO_NOV_2026 : CATALOGO_BASE_2026;
}

/**
 * Catálogo del periodo PAGADO de una licencia (upgrade y empresas
 * adicionales): el periodo empieza en periodo_desde (renovada por
 * anticipado) o en start_date. Un periodo que empezó antes del 1-nov-2026 es
 * de un cliente actual que aún no renueva: conserva su cupo y la empresa
 * adicional a 50k. Fechas de calendario de Colombia ('YYYY-MM-DD').
 */
export function catalogoDeLicencia(lic: { start_date: string; periodo_desde?: string | null }): Catalogo {
	const inicio = String(lic.periodo_desde || lic.start_date || '');
	return /^\d{4}-\d{2}-\d{2}$/.test(inicio) && inicio >= FECHA_CORTE_PRECIOS ? CATALOGO_NOV_2026 : CATALOGO_BASE_2026;
}

/**
 * SOLO COMPATIBILIDAD con el bot de ventas (SisteAcuseBot copia este archivo
 * con desplegar.sh y su conocimiento.ts importa PLANES y
 * PRECIO_EMPRESA_ADICIONAL para la lista de planes): el catálogo vigente
 * cuando se CARGA el módulo (una Edge Function en frío después del corte ya
 * ve el nuevo). El cobro NUNCA los usa: pagos_test.ts falla si una función de
 * este repo los importa.
 */
export const PLANES: Record<CodigoPlan, PlanCatalogo> = catalogoEn(Date.now()).planes;
/** SOLO COMPATIBILIDAD con el bot (ver PLANES). */
export const PRECIO_EMPRESA_ADICIONAL: number = catalogoEn(Date.now()).empresaAdicional;

// ── Plan MENSUAL (Entrega 3, docs/pagos/PLAN-MENSUAL.md del repo de la app) ──
//
// El mismo plan (Pyme…Ultra) pagado por 1 o 3 meses por ADELANTADO, sin
// renovación automática. Solo existe con el catálogo nov-2026. La licencia es
// la MISMA fila (licenses.periodicidad = 'mensual') y solo acusa lo emitido
// desde licenses.ventana_desde (inicio del primer periodo pagado − 30 días).
// «Ponerse al día» (SA-ALD2) cuesta lo mismo que el plan anual de ese plan y
// cupo. El paso al anual (SA-UPA2) cobra el anual menos lo pagado del periodo
// mensual que aún no se usa, por días (lo calcula la base:
// public.licencia_mensual_credito).
// Espejo en SQL: public._licencia_precio_mensual (migración
// 20261104130000_plan_mensual_cobro.sql); la app tiene el mismo catálogo para
// MOSTRAR (src/lib/cuenta/mensual.ts) y el sitio, src/lib/pricing.ts.

/** Precio por MES (COP) de cada plan. El Plan Empresa no tiene mensual. */
export const PRECIO_MENSUAL_NOV_2026: Record<CodigoPlan, number> = {
	PYME: 25_000,
	CONT: 45_000,
	PRO: 60_000,
	MAX: 95_000,
	ULTRA: 175_000,
};

/** Empresa adicional del Plan Pyme mensual, por mes (12 meses = 1,5 × los 75.000 del anual). */
export const EMPRESA_ADICIONAL_MENSUAL_PYME = 10_000;

/** Bloques que se venden. No hay «12 meses mensuales»: eso es el anual. */
export const MESES_MENSUAL = [1, 3] as const;
export type MesesMensual = (typeof MESES_MENSUAL)[number];

/** La ventana del mensual: lo emitido desde 30 días antes del inicio del periodo pagado. */
export const VENTANA_MENSUAL_DIAS = 30;

/**
 * Más meses por adelantado solo con el vencimiento a 62 días o menos (decisión
 * 10 del plan, pendiente del dueño): no se acumula un año de meses sueltos. Lo
 * aplica preparar-pago; la base aplica lo que ya se cobró aunque lo supere.
 */
export const TOPE_COMPRA_ADELANTADA_DIAS = 62;

export function esMesesMensual(x: unknown): x is MesesMensual {
	return x === 1 || x === 3;
}

/**
 * Precio (COP) de un bloque mensual: (plan + empresas adicionales del Pyme) ×
 * meses, sin descuento por los 3 meses (decisión 2) y sin cupones (decisión 3).
 */
export function precioMensual(plan: CodigoPlan, empresas: number, meses: MesesMensual): number {
	const base = CATALOGO_NOV_2026.planes[plan].empresas;
	const extras = plan === 'PYME' ? Math.max(0, empresas - base) : 0;
	return (PRECIO_MENSUAL_NOV_2026[plan] + extras * EMPRESA_ADICIONAL_MENSUAL_PYME) * meses;
}

/** Orden de upgrade: solo se sube, nunca se baja. */
export const ORDEN_PLANES: readonly CodigoPlan[] = CODIGOS_PLAN;

/** license_type de la tabla licenses → código (planes que se compran en línea). */
export const NOMBRE_A_CODIGO: Record<string, CodigoPlan> = Object.fromEntries(
	CODIGOS_PLAN.map((c) => [NOMBRE_PLAN[c], c]),
) as Record<string, CodigoPlan>;

/** Tope de empresas adicionales por compra (el mismo MAX_EXTRAS de la app). */
export const MAX_EXTRAS_PYME = 20;

/** Wompi no acepta cobros por debajo de $1.500. */
export const MONTO_MINIMO_CENTS = 150_000;

export const MONEDA = 'COP';

/** Vigencia de la firma que entrega preparar-pago (entra en la firma). */
export const VIGENCIA_FIRMA_MS = 60 * 60 * 1000;

/**
 * Renovación anticipada (SA-REN2): se puede pagar desde 90 días antes del
 * vencimiento (el mismo día del primer aviso por correo) y también después
 * de vencida. public.licencia_aplicar_renovacion (migración 20261003100000)
 * acepta un día más (91): la firma vale 1 h y puede cruzar la medianoche.
 */
export const VENTANA_RENOVACION_DIAS = 90;

/** Acepta el código (PYME) o el nombre (Plan Pyme) de un plan que se compra en línea. */
export function codigoPlan(x: unknown): CodigoPlan | null {
	if (typeof x !== 'string') return null;
	if ((CODIGOS_PLAN as readonly string[]).includes(x)) return x as CodigoPlan;
	return Object.hasOwn(NOMBRE_A_CODIGO, x) ? NOMBRE_A_CODIGO[x] : null;
}

/** Como codigoPlan, más ULTRA / Plan Contador Ultra (destino de una renovación). */
export function codigoPlanRenovacion(x: unknown): CodigoPlanRenovacion | null {
	if (x === CODIGO_ULTRA || x === NOMBRE_PLAN.ULTRA) return CODIGO_ULTRA;
	return codigoPlan(x);
}

// ── Reglas de empresas y precios ────────────────────────────────────────

export type Rechazo = { ok: false; codigo: string; mensaje: string };

/**
 * Empresas admitidas al crear una licencia. En el registro solo las base (las
 * adicionales se compran con sesión). En la compra, el Pyme admite base + 0..20
 * y los demás planes exactamente la base. La base es la del catálogo vigente.
 */
export function reglasEmpresas(
	cat: Catalogo,
	flujo: 'registro' | 'compra',
	plan: CodigoPlan,
	empresas: unknown,
): { ok: true; empresas: number } | Rechazo {
	const base = cat.planes[plan].empresas;
	const n = empresas === undefined || empresas === null ? base : Number(empresas);
	if (!Number.isSafeInteger(n)) {
		return { ok: false, codigo: 'empresas_invalidas', mensaje: 'Cantidad de empresas inválida.' };
	}
	if (flujo === 'registro' || plan !== 'PYME') {
		if (n !== base) {
			return {
				ok: false,
				codigo: 'empresas_invalidas',
				mensaje: plan === 'PYME'
					? 'Las empresas adicionales se compran después de crear la cuenta.'
					: `El ${cat.planes[plan].nombre} incluye ${base} empresas; para más, sube de plan.`,
			};
		}
		return { ok: true, empresas: n };
	}
	if (n < base || n > base + MAX_EXTRAS_PYME) {
		return {
			ok: false,
			codigo: 'empresas_invalidas',
			mensaje: `El Plan Pyme admite hasta ${MAX_EXTRAS_PYME} empresas adicionales por compra.`,
		};
	}
	return { ok: true, empresas: n };
}

/** Empresas adicionales sobre una licencia existente: solo Plan Pyme, 1..20. */
export function reglaExtras(licenseType: string | null | undefined, cantidad: unknown): { ok: true; cantidad: number } | Rechazo {
	if (licenseType !== NOMBRE_PLAN.PYME) {
		return {
			ok: false,
			codigo: 'extras_solo_pyme',
			mensaje: 'La empresa adicional solo aplica al Plan Pyme. Para más empresas, sube de plan.',
		};
	}
	const n = Number(cantidad);
	if (!Number.isSafeInteger(n) || n < 1 || n > MAX_EXTRAS_PYME) {
		return { ok: false, codigo: 'cantidad_invalida', mensaje: `Puedes agregar de 1 a ${MAX_EXTRAS_PYME} empresas por compra.` };
	}
	return { ok: true, cantidad: n };
}

/** Precio anual (COP) de un plan con sus empresas, en un catálogo. */
export function precioAnual(cat: Catalogo, plan: CodigoPlan, empresas: number): number {
	const extras = Math.max(0, empresas - cat.planes[plan].empresas);
	return cat.planes[plan].precio + extras * cat.empresaAdicional;
}

/** Una sola fórmula de descuento para todos los flujos (COP enteros). */
export function aplicarCupon(monto: number, pct: number): number {
	const p = Math.min(100, Math.max(0, Number(pct) || 0));
	return monto - Math.round((monto * p) / 100);
}

// ── Prorrateo (upgrade y empresas adicionales) ──────────────────────────

export interface LicenciaFechas {
	start_date: string;
	end_date: string;
	/**
	 * Primer día del último periodo anual pagado, cuando la licencia se extendió
	 * con una renovación anticipada (SA-REN2). null/ausente: el periodo empieza
	 * en start_date (todas las licencias anteriores a la renovación).
	 */
	periodo_desde?: string | null;
}

const DIA_MS = 86_400_000;

/**
 * Misma aritmética de siempre: ceil por día empezado. Fechas en UTC.
 * El "año" va de periodo_desde (si la licencia se renovó por anticipado) o de
 * start_date hasta end_date. Sin periodo_desde el resultado es idéntico al de
 * antes. Con periodo_desde en el futuro (renovada y aún en el periodo viejo),
 * diasRestantes cuenta también los días que faltan del periodo actual: el
 * upgrade y las empresas adicionales cobran hasta el nuevo end_date.
 */
export function prorrateo(lic: LicenciaFechas, ahora: Date): { totalDias: number; diasRestantes: number } {
	const inicio = Date.parse(`${lic.periodo_desde || lic.start_date}T00:00:00Z`);
	const fin = Date.parse(`${lic.end_date}T00:00:00Z`);
	if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return { totalDias: 1, diasRestantes: 0 };
	const totalDias = Math.max(1, Math.ceil((fin - inicio) / DIA_MS));
	const transcurridos = Math.min(totalDias, Math.ceil((ahora.getTime() - inicio) / DIA_MS));
	return { totalDias, diasRestantes: Math.max(0, totalDias - transcurridos) };
}

/** Upgrade prorrateado, con los precios del catálogo del periodo pagado (catalogoDeLicencia). */
export function montoUpgrade(cat: Catalogo, lic: LicenciaFechas, actual: CodigoPlan, objetivo: CodigoPlan, ahora: Date) {
	const { totalDias, diasRestantes } = prorrateo(lic, ahora);
	const precioActual = cat.planes[actual].precio;
	const precioNuevo = cat.planes[objetivo].precio;
	const credito = Math.round((diasRestantes / totalDias) * precioActual);
	const proporcional = Math.round((diasRestantes / totalDias) * precioNuevo);
	return {
		totalDias,
		diasRestantes,
		credito,
		proporcional,
		monto: Math.max(0, proporcional - credito),
		// Deriva de hasta 3 días entre la cotización y el webhook.
		tolerancia: Math.max(0, Math.ceil((3 * (precioNuevo - precioActual)) / totalDias)),
	};
}

/** Empresas adicionales prorrateadas, al precio del catálogo del periodo pagado (catalogoDeLicencia). */
export function montoExtras(cat: Catalogo, lic: LicenciaFechas, cantidad: number, ahora: Date) {
	const { totalDias, diasRestantes } = prorrateo(lic, ahora);
	return {
		totalDias,
		diasRestantes,
		monto: Math.round((diasRestantes / totalDias) * cat.empresaAdicional * cantidad),
		tolerancia: Math.ceil((3 * cat.empresaAdicional * cantidad) / totalDias),
	};
}

// ── Referencias ─────────────────────────────────────────────────────────
//
//   registro (nuevo)  SA-REG3-{PLAN}-{CUPON|0}-{ts}-{rand}      empresas = base
//   registro (viejo)  SA-{PLAN}-{empresas}-{ts}-{rand}          solo lectura
//   compra            SA-PUR2-{uid32}-{PLAN}-{empresas}-{CUPON|0}-{ts}-{rand}
//   upgrade           SA-UPG2-{uid32}-{PLAN}-{ts}-{rand}
//   extras            SA-ADD2-{uid32}-{cantidad}-{ts}-{rand}
//   renovación        SA-REN2-{uid32}-{PLAN}-{empresas}-{ts}-{rand}  (1..200 empresas, sin cupón;
//                     PLAN y empresas = plan y cupo DESTINO; PLAN admite ULTRA)
//   gratis            SA-FREE-{PLAN}-{ts}-{rand}                 (create-subscription, sin Wompi)
//   mensual           SA-MEN2-{uid32}-{PLAN}-{empresas}-{1|3}-{ts}-{rand}  (compra o extensión, Mi cuenta)
//   registro mensual  SA-RGM2-{PLAN}-{1|3}-{ts}-{rand}           (/registro?periodo=mensual; empresas = base)
//   ponerse al día    SA-ALD2-{uid32}-{ts}-{rand}                (plan y cupo: los de la licencia)
//   paso a anual      SA-UPA2-{uid32}-{PLAN}-{empresas}-{ts}-{rand} (mismo plan y cupo del mensual)
//
// Los `tipo` coinciden con _shared/referencias.ts de la rama de facturación.
// Los cuatro del mensual sin cupón y siempre con fila en pagos_preparados.

export const RE_CUPON = /^[A-Z0-9]{4,20}$/;

/**
 * `ts`: la marca de tiempo (ms) que el servidor puso al firmar. Decide el
 * catálogo de la cotización (catalogoEn): el webhook lo usa, acotado a su
 * propio reloj, solo si preparar-pago registró esa referencia (ver
 * instanteDeCotizacion en wompi-webhook).
 */
export type ReferenciaParseada =
	| { tipo: 'registro'; formato: 'reg3' | 'heredado'; plan: CodigoPlan; empresas: number; cupon: string | null; ts: number }
	| { tipo: 'pur2'; uid: string; plan: CodigoPlan; empresas: number; cupon: string | null; ts: number }
	| { tipo: 'upg2'; uid: string; plan: CodigoPlan; ts: number }
	| { tipo: 'add2'; uid: string; cantidad: number; ts: number }
	/** plan = plan DESTINO de la renovación (desde el 1-nov-2026 puede cambiar, incluso a ULTRA); empresas = cupo nuevo. */
	| { tipo: 'ren2'; uid: string; plan: CodigoPlanRenovacion; empresas: number; ts: number }
	/** Plan mensual: compra o extensión por 1 o 3 meses (la base decide cuál). */
	| { tipo: 'men2'; uid: string; plan: CodigoPlan; empresas: number; meses: MesesMensual; ts: number }
	/** Registro nuevo en mensual (sin cuenta): empresas = base del plan. */
	| { tipo: 'rgm2'; plan: CodigoPlan; empresas: number; meses: MesesMensual; ts: number }
	/** «Ponerse al día»: el plan y el cupo salen de la licencia mensual. */
	| { tipo: 'ald2'; uid: string; ts: number }
	/** Paso del mensual al anual, mismo plan y cupo. */
	| { tipo: 'upa2'; uid: string; plan: CodigoPlan; empresas: number; ts: number };

// ULTRA se compra en línea desde el 1-nov-2026, así que entra en TODOS los
// flujos (registro, compra, upgrade), no solo en la renovación.
const PLAN = '(PYME|CONT|PRO|MAX|ULTRA)';
const PLAN_REN = PLAN;
const COLA = '([0-9]{10,16})-([a-z0-9]{1,12})';
const RE_REG3 = new RegExp(`^SA-REG3-${PLAN}-(0|[A-Z0-9]{4,20})-${COLA}$`);
const RE_REGISTRO_VIEJO = new RegExp(`^SA-${PLAN}-([1-9][0-9]{0,2})-${COLA}$`);
// PUR2 conserva {1,20} en el cupón: así la escribía el /planes viejo.
const RE_PUR2 = new RegExp(`^SA-PUR2-([0-9a-f]{32})-${PLAN}-([1-9][0-9]{0,2})-(0|[A-Z0-9]{1,20})-${COLA}$`);
const RE_UPG2 = new RegExp(`^SA-UPG2-([0-9a-f]{32})-${PLAN}-${COLA}$`);
const RE_ADD2 = new RegExp(`^SA-ADD2-([0-9a-f]{32})-([1-9][0-9]{0,2})-${COLA}$`);
const RE_REN2 = new RegExp(`^SA-REN2-([0-9a-f]{32})-${PLAN_REN}-([1-9][0-9]{0,2})-${COLA}$`);
// Plan mensual. Espejo en SQL: checkouts_referencia_formato y
// _facturacion_parsear_referencia (20261104130000); pagos_test.ts los compara.
export const RE_MEN2 = new RegExp(`^SA-MEN2-([0-9a-f]{32})-${PLAN}-([1-9][0-9]{0,2})-([13])-${COLA}$`);
export const RE_RGM2 = new RegExp(`^SA-RGM2-${PLAN}-([13])-${COLA}$`);
export const RE_ALD2 = new RegExp(`^SA-ALD2-([0-9a-f]{32})-${COLA}$`);
export const RE_UPA2 = new RegExp(`^SA-UPA2-([0-9a-f]{32})-${PLAN}-([1-9][0-9]{0,2})-${COLA}$`);

/** Tope de empresas de una SA-REN2 (el mismo del espejo SQL y de la tabla licencia_renovaciones). */
export const MAX_EMPRESAS_RENOVACION = 200;

export function uuidDesdeHex(hex: string): string {
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hexDesdeUuid(uid: string): string | null {
	const hex = String(uid).toLowerCase().replace(/-/g, '');
	return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/** null si no es de ningún flujo conocido. Nunca lanza. */
export function parsearReferencia(ref: unknown): ReferenciaParseada | null {
	if (typeof ref !== 'string' || ref.length > 128) return null;
	let m = RE_REG3.exec(ref);
	if (m) {
		const plan = m[1] as CodigoPlan;
		const ts = Number(m[3]);
		// Las empresas base del catálogo en que se firmó (Contador: 10 hasta el 31-oct-2026, 5 después).
		return { tipo: 'registro', formato: 'reg3', plan, empresas: catalogoEn(ts).planes[plan].empresas, cupon: m[2] === '0' ? null : m[2], ts };
	}
	m = RE_PUR2.exec(ref);
	if (m) {
		return { tipo: 'pur2', uid: uuidDesdeHex(m[1]), plan: m[2] as CodigoPlan, empresas: Number(m[3]), cupon: m[4] === '0' ? null : m[4], ts: Number(m[5]) };
	}
	m = RE_UPG2.exec(ref);
	if (m) return { tipo: 'upg2', uid: uuidDesdeHex(m[1]), plan: m[2] as CodigoPlan, ts: Number(m[3]) };
	m = RE_ADD2.exec(ref);
	if (m) {
		const cantidad = Number(m[2]);
		if (cantidad > 100) return null;
		return { tipo: 'add2', uid: uuidDesdeHex(m[1]), cantidad, ts: Number(m[3]) };
	}
	m = RE_REN2.exec(ref);
	if (m) {
		const empresas = Number(m[3]);
		if (empresas > MAX_EMPRESAS_RENOVACION) return null;
		return { tipo: 'ren2', uid: uuidDesdeHex(m[1]), plan: m[2] as CodigoPlanRenovacion, empresas, ts: Number(m[4]) };
	}
	m = RE_MEN2.exec(ref);
	if (m) {
		const empresas = Number(m[3]);
		if (empresas > MAX_EMPRESAS_RENOVACION) return null;
		return { tipo: 'men2', uid: uuidDesdeHex(m[1]), plan: m[2] as CodigoPlan, empresas, meses: Number(m[4]) as MesesMensual, ts: Number(m[5]) };
	}
	m = RE_RGM2.exec(ref);
	if (m) {
		const plan = m[1] as CodigoPlan;
		// El mensual solo existe con el catálogo nov-2026: su base (Contador 5).
		return { tipo: 'rgm2', plan, empresas: CATALOGO_NOV_2026.planes[plan].empresas, meses: Number(m[2]) as MesesMensual, ts: Number(m[3]) };
	}
	m = RE_ALD2.exec(ref);
	if (m) return { tipo: 'ald2', uid: uuidDesdeHex(m[1]), ts: Number(m[2]) };
	m = RE_UPA2.exec(ref);
	if (m) {
		const empresas = Number(m[3]);
		if (empresas > MAX_EMPRESAS_RENOVACION) return null;
		return { tipo: 'upa2', uid: uuidDesdeHex(m[1]), plan: m[2] as CodigoPlan, empresas, ts: Number(m[4]) };
	}
	m = RE_REGISTRO_VIEJO.exec(ref);
	if (m) return { tipo: 'registro', formato: 'heredado', plan: m[1] as CodigoPlan, empresas: Number(m[2]), cupon: null, ts: Number(m[3]) };
	return null;
}

/** Cola aleatoria de la referencia (crypto, base 36, 8 caracteres). */
export function generarRand(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

function cola(ahora: Date): string {
	return `${ahora.getTime()}-${generarRand()}`;
}

export function refRegistro(plan: CodigoPlan, cupon: string | null, ahora: Date): string {
	return `SA-REG3-${plan}-${cupon ?? '0'}-${cola(ahora)}`;
}

export function refCompra(uid: string, plan: CodigoPlan, empresas: number, cupon: string | null, ahora: Date): string {
	const hex = hexDesdeUuid(uid);
	if (!hex) throw new Error('uid inválido');
	return `SA-PUR2-${hex}-${plan}-${empresas}-${cupon ?? '0'}-${cola(ahora)}`;
}

export function refUpgrade(uid: string, plan: CodigoPlan, ahora: Date): string {
	const hex = hexDesdeUuid(uid);
	if (!hex) throw new Error('uid inválido');
	return `SA-UPG2-${hex}-${plan}-${cola(ahora)}`;
}

export function refExtras(uid: string, cantidad: number, ahora: Date): string {
	const hex = hexDesdeUuid(uid);
	if (!hex) throw new Error('uid inválido');
	return `SA-ADD2-${hex}-${cantidad}-${cola(ahora)}`;
}

export function refRenovacion(uid: string, plan: CodigoPlanRenovacion, empresas: number, ahora: Date): string {
	const hex = hexDesdeUuid(uid);
	if (!hex) throw new Error('uid inválido');
	if (!Number.isSafeInteger(empresas) || empresas < 1 || empresas > MAX_EMPRESAS_RENOVACION) {
		throw new Error('empresas inválidas');
	}
	return `SA-REN2-${hex}-${plan}-${empresas}-${cola(ahora)}`;
}

export function refGratis(plan: CodigoPlan, ahora: Date): string {
	return `SA-FREE-${plan}-${cola(ahora)}`;
}

function hexObligatorio(uid: string): string {
	const hex = hexDesdeUuid(uid);
	if (!hex) throw new Error('uid inválido');
	return hex;
}

function empresasDeReferencia(empresas: number): number {
	if (!Number.isSafeInteger(empresas) || empresas < 1 || empresas > MAX_EMPRESAS_RENOVACION) throw new Error('empresas inválidas');
	return empresas;
}

function mesesDeReferencia(meses: number): MesesMensual {
	if (!esMesesMensual(meses)) throw new Error('meses inválidos');
	return meses;
}

export function refMensual(uid: string, plan: CodigoPlan, empresas: number, meses: number, ahora: Date): string {
	return `SA-MEN2-${hexObligatorio(uid)}-${plan}-${empresasDeReferencia(empresas)}-${mesesDeReferencia(meses)}-${cola(ahora)}`;
}

export function refRegistroMensual(plan: CodigoPlan, meses: number, ahora: Date): string {
	return `SA-RGM2-${plan}-${mesesDeReferencia(meses)}-${cola(ahora)}`;
}

export function refAlDia(uid: string, ahora: Date): string {
	return `SA-ALD2-${hexObligatorio(uid)}-${cola(ahora)}`;
}

export function refAnualizar(uid: string, plan: CodigoPlan, empresas: number, ahora: Date): string {
	return `SA-UPA2-${hexObligatorio(uid)}-${plan}-${empresasDeReferencia(empresas)}-${cola(ahora)}`;
}

/** Normaliza lo que escribe el usuario. null si no tiene forma de cupón. */
export function normalizarCupon(x: unknown): string | null {
	if (typeof x !== 'string') return null;
	const c = x.trim().toUpperCase();
	return RE_CUPON.test(c) ? c : null;
}

// ── Fechas de calendario (renovación) ───────────────────────────────────
//
// 'YYYY-MM-DD' sin zona. El "hoy" del negocio es el de Colombia: una licencia
// vale hasta el final de su end_date en hora de Bogotá.

const RE_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function partesISO(iso: string): [number, number, number] {
	const m = RE_FECHA_ISO.exec(String(iso));
	if (!m) throw new Error(`fecha inválida: ${iso}`);
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = new Date(Date.UTC(y, mo - 1, d));
	if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) {
		throw new Error(`fecha inválida: ${iso}`);
	}
	return [y, mo, d];
}

const isoDeUTC = (t: Date) => t.toISOString().slice(0, 10);

/** Fecha de hoy en Colombia (America/Bogota) para el instante `ahora`. */
export function fechaBogota(ahora: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
	}).format(ahora);
}

export function sumarDiasISO(iso: string, n: number): string {
	const [y, mo, d] = partesISO(iso);
	return isoDeUTC(new Date(Date.UTC(y, mo - 1, d + n)));
}

/** Un año de calendario, como `date + interval '1 year'` de Postgres: 29-feb → 28-feb. */
export function sumarUnAnioISO(iso: string): string {
	const [y, mo, d] = partesISO(iso);
	const ultimoDia = new Date(Date.UTC(y + 1, mo, 0)).getUTCDate();
	return isoDeUTC(new Date(Date.UTC(y + 1, mo - 1, Math.min(d, ultimoDia))));
}

/**
 * `n` meses de calendario, como `date + make_interval(months => n)` de
 * Postgres: el mismo día del mes, o el último si no existe (31-ene + 1 = 28-feb).
 */
export function sumarMesesISO(iso: string, n: number): string {
	const [y, mo, d] = partesISO(iso);
	const total = mo - 1 + n;
	const y2 = y + Math.floor(total / 12);
	const m2 = ((total % 12) + 12) % 12;
	const ultimoDia = new Date(Date.UTC(y2, m2 + 1, 0)).getUTCDate();
	return isoDeUTC(new Date(Date.UTC(y2, m2, Math.min(d, ultimoDia))));
}

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntreISO(desde: string, hasta: string): number {
	const [y1, m1, d1] = partesISO(desde);
	const [y2, m2, d2] = partesISO(hasta);
	return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DIA_MS);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2027-02-15' → '15 de febrero de 2027'. */
export function fechaLegible(iso: string): string {
	const [y, mo, d] = partesISO(iso);
	return `${d} de ${MESES[mo - 1]} de ${y}`;
}

// ── Renovación anticipada (SA-REN2) ─────────────────────────────────────

export type LicenciaParaRenovar = LicenciaFechas & {
	id?: string | null;
	license_type: string;
	companies_number: number | string | null;
	is_active?: boolean | null;
	/** Prueba gratis de 7 días (la compra la reemplaza). */
	es_prueba?: boolean | null;
	/**
	 * Plan mensual (migración 20261104120000 de la app). Ausente o 'anual' =
	 * todo como antes. Las fechas son 'YYYY-MM-DD' o null.
	 */
	periodicidad?: string | null;
	ventana_desde?: string | null;
	al_dia_hasta?: string | null;
};

/** ¿La fila es del plan mensual? Sin la columna (base sin migrar), nunca. */
export function esLicenciaMensual(lic: { periodicidad?: string | null } | null | undefined): boolean {
	return lic?.periodicidad === 'mensual';
}

/**
 * Fila mensual PAGADA ya vencida (`end_date` antes de hoy en Bogotá), aunque la
 * tarea nocturna todavía no la haya apagado. No bloquea comprar el anual (PUR2):
 * preparar-pago la deja cotizar y wompi-webhook la apaga antes de crear la anual.
 * Una fila anual vencida no entra (sigue por la renovación, como siempre).
 */
export function esMensualVencida(
	lic: { periodicidad?: string | null; es_prueba?: boolean | null; end_date?: string | null } | null | undefined,
	hoy: string,
): boolean {
	return !!lic && esLicenciaMensual(lic) && lic.es_prueba !== true && typeof lic.end_date === 'string' && lic.end_date < hoy;
}

const NO_APLICA_MENSUAL =
	'Tu plan es mensual: para cambiar de plan o sumar empresas, pasa al plan anual desde Mi cuenta en app.sisteacuse.com.';

export type ReglaRenovacionOk = {
	ok: true;
	/** Plan y cupo ACTUALES de la licencia (con las reglas nuevas, null si el plan no se vende en línea: Ultra). */
	plan: CodigoPlan | null;
	empresas: number;
	/** extendida: se alarga la misma fila; nueva: la licencia ya venció y se crea otra. */
	modo: 'extendida' | 'nueva';
	desde: string;
	hasta: string;
	/** Días de hoy a end_date (negativo si ya venció). */
	diasRestantes: number;
};

const WHATSAPP_RENOVACION = 'Escríbenos por WhatsApp y te ayudamos a renovarlo.';

/**
 * Regla pura de la ventana de la renovación. Nunca lee la base. `hoy` es la
 * fecha de Colombia (fechaBogota). El espejo en SQL es
 * public.licencia_aplicar_renovacion(_v2), que decide al aplicar el pago.
 *  - Vigente con end_date − hoy ≤ 90: se extiende la misma fila desde el día
 *    siguiente al vencimiento (no se pierde ningún día).
 *  - Vencida (o activa con end_date pasado): licencia nueva desde hoy.
 *  - Licencia desactivada a mano con días por delante: a mano.
 *  - reglasNuevas = false (cotizado antes del 1-nov-2026): además mismo plan y
 *    mismo cupo; plan desconocido, cupo distinto a la base fuera del Pyme o
 *    Pyme fuera de 1..200: a mano.
 *  - reglasNuevas = true: el plan y el cupo destino los decide la base
 *    (licencia_cotizar_renovacion); aquí solo la ventana.
 */
export function reglaRenovacion(
	lic: LicenciaParaRenovar | null | undefined,
	hoy: string,
	reglasNuevas = false,
): ReglaRenovacionOk | (Rechazo & { status: number }) {
	const mal = (status: number, codigo: string, mensaje: string) => ({ ok: false as const, status, codigo, mensaje });
	if (!lic) return mal(409, 'sin_licencia', 'No tienes un plan para renovar. Elige uno en sisteacuse.com/planes.');
	const plan = codigoPlan(lic.license_type);
	const empresas = Number(lic.companies_number);
	const manual = mal(409, 'renovacion_manual', `Tu plan necesita una renovación especial. ${WHATSAPP_RENOVACION}`);
	if (!reglasNuevas) {
		if (!plan || !Number.isSafeInteger(empresas)) return manual;
		if (plan === 'PYME') {
			if (empresas < 1 || empresas > MAX_EMPRESAS_RENOVACION) return manual;
		} else if (empresas !== CATALOGO_BASE_2026.planes[plan].empresas) {
			return manual;
		}
	} else if (!codigoPlanRenovacion(lic.license_type)) {
		return manual;
	}
	let dias: number;
	try {
		dias = diasEntreISO(hoy, lic.end_date);
	} catch {
		return manual;
	}
	const activa = lic.is_active === true;
	if (!activa && dias >= 0) {
		return mal(409, 'renovacion_manual', `Tu plan está desactivado. ${WHATSAPP_RENOVACION}`);
	}
	if (activa && dias >= 0) {
		if (dias > VENTANA_RENOVACION_DIAS) {
			const abre = fechaLegible(sumarDiasISO(lic.end_date, -VENTANA_RENOVACION_DIAS));
			return mal(409, 'fuera_de_ventana', `Tu plan vence el ${fechaLegible(lic.end_date)}. Puedes renovarlo desde el ${abre}.`);
		}
		const desde = sumarDiasISO(lic.end_date, 1);
		return { ok: true, plan, empresas, modo: 'extendida', desde, hasta: sumarUnAnioISO(desde), diasRestantes: dias };
	}
	return { ok: true, plan, empresas, modo: 'nueva', desde: hoy, hasta: sumarUnAnioISO(hoy), diasRestantes: dias };
}

/**
 * Lo que cuesta renovar ANTES del 1-nov-2026: el precio anual del plan con su
 * cupo en el catálogo de entonces (sin cupones ni prorrateo).
 */
export function montoRenovacionCents(plan: CodigoPlan, empresas: number): number {
	return precioAnual(CATALOGO_BASE_2026, plan, empresas) * 100;
}

/**
 * Cotización de la renovación desde el 1-nov-2026, tal como la devuelve
 * public.licencia_cotizar_renovacion (migración 20261010100000). La base es
 * la única fuente del precio de fundador: la usan preparar-pago (cotiza y
 * firma) y licencia_aplicar_renovacion_v2 (la vuelve a calcular al aplicar).
 */
export interface CotizacionRenovacion {
	resultado: 'ok' | 'manual';
	/** manual: sin_licencia, plan_desconocido, cupo_especial, ultra_ventas, plan_ultra, sin_precio_hoy. */
	codigo: string | null;
	reglas: 'base-2026' | 'nov-2026';
	plan_anterior: string | null;
	cupo_anterior: number | null;
	empresas_registradas: number;
	fundador: boolean;
	paso: number | null;
	grupo: string | null;
	plan_codigo: CodigoPlanRenovacion | null;
	plan: string | null;
	cupo: number | null;
	precio: number | null;
	precio_plan: number | null;
	empresas_adicionales: number;
	precio_adicionales: number;
	precio_lista: number | null;
	precio_hoy: number | null;
}

const entero = (x: unknown): number | null => {
	const n = typeof x === 'string' && /^-?\d{1,15}$/.test(x) ? Number(x) : x;
	return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
};

/** Valida lo que devolvió la RPC. null si no tiene la forma esperada. */
export function leerCotizacionRenovacion(x: unknown): CotizacionRenovacion | null {
	if (!x || typeof x !== 'object') return null;
	const d = x as Record<string, unknown>;
	if (d.resultado !== 'ok' && d.resultado !== 'manual') return null;
	if (d.reglas !== 'base-2026' && d.reglas !== 'nov-2026') return null;
	const planCodigo = d.plan_codigo === null || d.plan_codigo === undefined ? null : codigoPlanRenovacion(d.plan_codigo);
	const q: CotizacionRenovacion = {
		resultado: d.resultado,
		codigo: typeof d.codigo === 'string' && /^[a-z_]{1,40}$/.test(d.codigo) ? d.codigo : null,
		reglas: d.reglas,
		plan_anterior: typeof d.plan_anterior === 'string' ? d.plan_anterior : null,
		cupo_anterior: entero(d.cupo_anterior),
		empresas_registradas: entero(d.empresas_registradas) ?? 0,
		fundador: d.fundador === true,
		paso: entero(d.paso),
		grupo: typeof d.grupo === 'string' && /^[A-Z_]{1,20}$/.test(d.grupo) ? d.grupo : null,
		plan_codigo: planCodigo,
		plan: planCodigo ? NOMBRE_PLAN[planCodigo] : null,
		cupo: entero(d.cupo),
		precio: entero(d.precio),
		precio_plan: entero(d.precio_plan),
		empresas_adicionales: entero(d.empresas_adicionales) ?? 0,
		precio_adicionales: entero(d.precio_adicionales) ?? 0,
		precio_lista: entero(d.precio_lista),
		precio_hoy: entero(d.precio_hoy),
	};
	if (q.resultado === 'ok') {
		if (!q.plan_codigo || q.cupo === null || q.cupo < 1 || q.cupo > MAX_EMPRESAS_RENOVACION) return null;
		if (q.precio === null || q.precio <= 0) return null;
	}
	return q;
}

/** Mensaje al cliente cuando la renovación va por WhatsApp (resultado 'manual'). */
export function mensajeRenovacionManual(q: Pick<CotizacionRenovacion, 'codigo'>): string {
	if (q.codigo === 'ultra_ventas' || q.codigo === 'plan_ultra') {
		return 'Con más de 20 empresas tu plan pasa al Plan Contador Ultra, que se acuerda con nuestro equipo. Escríbenos por WhatsApp y lo renovamos contigo.';
	}
	return `Tu plan necesita una renovación especial. ${WHATSAPP_RENOVACION}`;
}

/**
 * Lee la cotización de la base con service role. null si la RPC aún no existe
 * (migración 20261010100000 sin aplicar). Lanza si la base falla o responde
 * algo sin forma: quien llama no cotiza a ciegas.
 */
// deno-lint-ignore no-explicit-any
export async function cotizarRenovacionEnBase(admin: any, uid: string, instante: Date): Promise<CotizacionRenovacion | null> {
	const { data, error } = await admin.rpc('licencia_cotizar_renovacion', {
		p_user_id: uid,
		p_instante: instante.toISOString(),
	});
	if (error) {
		if (esFuncionInexistente(error)) return null;
		throw new Error(`licencia_cotizar_renovacion falló: ${error.message}`);
	}
	const q = leerCotizacionRenovacion(data);
	if (!q) throw new Error('licencia_cotizar_renovacion respondió sin la forma esperada');
	return q;
}

/** La función no existe: 42883 en Postgres, PGRST202 en PostgREST. */
export function esFuncionInexistente(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
	if (!error) return false;
	const c = String(error.code ?? '');
	return c === '42883' || c === 'PGRST202';
}

// ── Cotización ──────────────────────────────────────────────────────────

export type EntradaCotizacion =
	| { flujo: 'registro'; plan: CodigoPlan }
	| { flujo: 'compra'; plan: CodigoPlan; empresas: number }
	| { flujo: 'upgrade'; plan: CodigoPlan }
	| { flujo: 'extras'; cantidad: number }
	/**
	 * El plan sale de la licencia (y desde el 1-nov-2026, de la base); si llega
	 * (el que mostró la app), debe ser el actual o el destino de la cotización.
	 */
	| { flujo: 'renovacion'; plan?: CodigoPlanRenovacion | null }
	/** Plan mensual con sesión: compra (sin plan, prueba o vencido) o extensión del vigente. */
	| { flujo: 'mensual'; plan: CodigoPlan; empresas: number; meses: MesesMensual }
	/** Registro nuevo en mensual (sin cuenta): empresas = base del plan. */
	| { flujo: 'registro_mensual'; plan: CodigoPlan; meses: MesesMensual }
	/** «Ponerse al día»: plan y cupo de la licencia mensual vigente. */
	| { flujo: 'al_dia' }
	/** Paso del mensual vigente al anual; plan y empresas los que mostró la app (deben ser los de la licencia). */
	| { flujo: 'anualizar'; plan: CodigoPlan; empresas: number };

export type FlujoMensual = 'mensual' | 'registro_mensual' | 'al_dia' | 'anualizar';
export const FLUJOS_MENSUAL: readonly FlujoMensual[] = ['mensual', 'registro_mensual', 'al_dia', 'anualizar'];
export function esFlujoMensual(x: unknown): x is FlujoMensual {
	return typeof x === 'string' && (FLUJOS_MENSUAL as readonly string[]).includes(x);
}

export interface ContextoCotizacion {
	ahora: Date;
	/**
	 * Instante de la cotización para elegir el catálogo (registro, compra y
	 * renovación). Por defecto `ahora`; el webhook pasa el de la referencia.
	 */
	instante?: Date;
	/** Porcentaje del cupón YA validado (solo registro y compra). */
	cuponPct?: number;
	cupon?: string | null;
	/** Licencia activa (upgrade y extras) o la última licencia (renovación). */
	licencia?: LicenciaParaRenovar | null;
	/** Renovación desde el 1-nov-2026: la cotización de la base (cotizarRenovacionEnBase). */
	renovacion?: CotizacionRenovacion | null;
	/** Paso a anual: lo ya pagado del periodo mensual en curso (centavos), de creditoAnualizar(). */
	creditoAnualizarCents?: number | null;
}

export type Desglose = Record<string, unknown> & { total: number };

export type Cotizacion =
	| { ok: true; montoCents: number; desglose: Desglose; toleranciaCents: number }
	| (Rechazo & { status: number });

/** ¿La licencia está vigente hoy (activa y sin vencer, fechas de Colombia)? */
function vigenteHoy(lic: LicenciaParaRenovar | null | undefined, hoy: string): boolean {
	return !!lic && lic.is_active === true && typeof lic.end_date === 'string' && lic.end_date >= hoy;
}

/** Precio anual nov-2026 del plan con su cupo (adicionales solo en el Pyme): lo que cuesta Ponerse al día y el anual. */
export function precioAnualMensual(plan: CodigoPlan, empresas: number): number {
	const base = CATALOGO_NOV_2026.planes[plan].empresas;
	const extras = plan === 'PYME' ? Math.max(0, empresas - base) : 0;
	return CATALOGO_NOV_2026.planes[plan].precio + extras * CATALOGO_NOV_2026.empresaAdicional;
}

/** Mínimo que se cobra al pasar al anual: el crédito nunca deja el pago en cero (decisión 4). */
export const MINIMO_ANUALIZAR_CENTS = MONTO_MINIMO_CENTS;

/**
 * Cotización de los cuatro flujos del mensual. Regla pura: la licencia (con
 * sus columnas del mensual) y el crédito del paso a anual llegan en `ctx`. La
 * base la vuelve a calcular al aplicar (public.licencia_aplicar_mensual,
 * licencia_aplicar_al_dia, licencia_pasar_a_anual): si lo pagado no alcanza,
 * no se aplica.
 */
function cotizarMensual(e: Extract<EntradaCotizacion, { flujo: FlujoMensual }>, ctx: ContextoCotizacion): Cotizacion {
	const mal = (status: number, codigo: string, mensaje: string) => ({ ok: false as const, status, codigo, mensaje });
	const hoy = fechaBogota(ctx.ahora);
	const cat = CATALOGO_NOV_2026;
	const lic = ctx.licencia ?? null;
	const vigente = vigenteHoy(lic, hoy) && lic?.es_prueba !== true;
	const mensualVigente = vigente && esLicenciaMensual(lic);

	if (e.flujo === 'mensual' || e.flujo === 'registro_mensual') {
		const r = reglasEmpresas(cat, e.flujo === 'mensual' ? 'compra' : 'registro', e.plan, e.flujo === 'mensual' ? e.empresas : undefined);
		if (!r.ok) return { ...r, status: 400 };
		const empresas = r.empresas;
		let modo: 'nueva' | 'extension' = 'nueva';
		let desde = hoy;
		let hasta = sumarMesesISO(hoy, e.meses);
		let ventanaDesde = sumarDiasISO(hoy, -VENTANA_MENSUAL_DIAS);
		if (e.flujo === 'mensual' && vigente) {
			if (!mensualVigente) {
				return mal(409, 'ya_tiene_licencia', 'Ya tienes un plan anual activo. Para renovarlo, entra a Mi cuenta en app.sisteacuse.com.');
			}
			if (lic!.license_type !== cat.planes[e.plan].nombre) {
				return mal(409, 'plan_distinto', `Tu plan mensual es ${lic!.license_type}. Para cambiar de plan, pasa al plan anual.`);
			}
			if (Number(lic!.companies_number) !== empresas) {
				return mal(409, 'cupo_distinto', 'Los meses se compran con las mismas empresas de tu plan. Para cambiar el cupo, pasa al plan anual.');
			}
			const dias = diasEntreISO(hoy, lic!.end_date);
			if (dias > TOPE_COMPRA_ADELANTADA_DIAS) {
				const abre = fechaLegible(sumarDiasISO(lic!.end_date, -TOPE_COMPRA_ADELANTADA_DIAS));
				return mal(409, 'compra_adelantada_tope', `Tu plan mensual va hasta el ${fechaLegible(lic!.end_date)}. Puedes comprar más meses desde el ${abre}.`);
			}
			modo = 'extension';
			desde = sumarDiasISO(lic!.end_date, 1);
			hasta = sumarMesesISO(lic!.end_date, e.meses);
			ventanaDesde = String(lic!.ventana_desde ?? '') || ventanaDesde;
		}
		const precio = precioMensual(e.plan, empresas, e.meses);
		const extras = e.plan === 'PYME' ? empresas - cat.planes.PYME.empresas : 0;
		return {
			ok: true,
			montoCents: precio * 100,
			toleranciaCents: 0,
			desglose: {
				flujo: e.flujo,
				plan: cat.planes[e.plan].nombre,
				planCodigo: e.plan,
				empresas,
				meses: e.meses,
				precioMes: PRECIO_MENSUAL_NOV_2026[e.plan],
				empresasAdicionales: extras,
				precioEmpresaAdicionalMes: EMPRESA_ADICIONAL_MENSUAL_PYME,
				precio,
				credito: 0,
				modo,
				vigenciaDesde: desde,
				vigenciaHasta: hasta,
				ventanaDesde,
				catalogo: cat.id,
				total: precio,
			},
		};
	}

	// Ponerse al día y el paso al anual: sobre el mensual vigente.
	if (!lic || !esLicenciaMensual(lic)) {
		return mal(409, 'sin_mensual', e.flujo === 'al_dia'
			? 'Ponerse al día es para el plan mensual.'
			: 'El paso al plan anual es para el plan mensual.');
	}
	if (!mensualVigente) {
		return mal(409, 'mensual_vencido', 'Tu plan mensual venció: ya no hay periodo que pasar al anual. Compra meses o compra el plan anual en Mi cuenta.');
	}
	const plan = codigoPlan(lic.license_type);
	const empresas = Number(lic.companies_number);
	if (!plan || !Number.isSafeInteger(empresas) || empresas < 1) {
		return mal(409, 'renovacion_manual', `Tu plan necesita un cambio especial. ${WHATSAPP_RENOVACION}`);
	}
	const anual = precioAnualMensual(plan, empresas);

	if (e.flujo === 'al_dia') {
		if (lic.al_dia_hasta && lic.ventana_desde && lic.al_dia_hasta >= lic.ventana_desde) {
			return mal(409, 'ya_al_dia', 'Ya te pusiste al día: tu plan acusa todo lo emitido antes de tu ventana.');
		}
		return {
			ok: true,
			montoCents: anual * 100,
			toleranciaCents: 0,
			desglose: {
				flujo: 'al_dia',
				plan: cat.planes[plan].nombre,
				planCodigo: plan,
				empresas,
				precio: anual,
				credito: 0,
				alDiaHasta: hoy,
				ventanaDesde: lic.ventana_desde ?? null,
				vigenciaHasta: lic.end_date,
				catalogo: cat.id,
				total: anual,
			},
		};
	}

	if (e.plan !== plan || e.empresas !== empresas) {
		return mal(409, 'licencia_cambio', 'Tu plan cambió. Recarga la página.');
	}
	const creditoBruto = Math.max(0, Math.trunc(Number(ctx.creditoAnualizarCents ?? 0)) || 0);
	const creditoCents = Math.min(creditoBruto, anual * 100 - MINIMO_ANUALIZAR_CENTS);
	const totalCents = anual * 100 - creditoCents;
	return {
		ok: true,
		montoCents: totalCents,
		toleranciaCents: 0,
		desglose: {
			flujo: 'anualizar',
			plan: cat.planes[plan].nombre,
			planCodigo: plan,
			empresas,
			precio: anual,
			credito: Math.round(creditoCents / 100),
			creditoTope: creditoBruto > creditoCents,
			vigenciaDesde: hoy,
			vigenciaHasta: sumarUnAnioISO(hoy),
			catalogo: cat.id,
			total: Math.round(totalCents / 100),
		},
	};
}

/** Monto a cobrar según el flujo. No lee nada: el cupón, la licencia y la cotización de la base llegan en `ctx`. */
export function cotizar(e: EntradaCotizacion, ctx: ContextoCotizacion): Cotizacion {
	const mal = (status: number, codigo: string, mensaje: string) => ({ ok: false as const, status, codigo, mensaje });
	const instante = ctx.instante ?? ctx.ahora;

	if (e.flujo === 'mensual' || e.flujo === 'registro_mensual' || e.flujo === 'al_dia' || e.flujo === 'anualizar') {
		return cotizarMensual(e, ctx);
	}
	// Upgrade, empresas adicionales y renovación no existen sobre una fila
	// mensual (decisión 9): el mensual crece pasando al anual.
	if ((e.flujo === 'upgrade' || e.flujo === 'extras' || e.flujo === 'renovacion') && esLicenciaMensual(ctx.licencia)) {
		return mal(409, 'no_aplica_mensual', e.flujo === 'renovacion'
			? 'Tu plan es mensual: compra más meses o pasa al plan anual desde Mi cuenta en app.sisteacuse.com.'
			: NO_APLICA_MENSUAL);
	}

	if (e.flujo === 'registro' || e.flujo === 'compra') {
		const cat = catalogoEn(instante);
		const r = reglasEmpresas(cat, e.flujo, e.plan, e.flujo === 'compra' ? e.empresas : undefined);
		if (!r.ok) return { ...r, status: 400 };
		const subtotal = precioAnual(cat, e.plan, r.empresas);
		const pct = ctx.cuponPct ?? 0;
		const total = aplicarCupon(subtotal, pct);
		const extras = r.empresas - cat.planes[e.plan].empresas;
		return {
			ok: true,
			montoCents: total * 100,
			toleranciaCents: 0,
			desglose: {
				flujo: e.flujo,
				plan: cat.planes[e.plan].nombre,
				empresas: r.empresas,
				precioPlan: cat.planes[e.plan].precio,
				empresasAdicionales: extras,
				precioEmpresaAdicional: cat.empresaAdicional,
				precioAdicionales: extras * cat.empresaAdicional,
				subtotal,
				cupon: pct > 0 ? (ctx.cupon ?? null) : null,
				cuponPct: pct,
				descuento: subtotal - total,
				catalogo: cat.id,
				total,
			},
		};
	}

	if (e.flujo === 'renovacion') {
		const nuevas = rigePrecioNuevo(instante);
		const r = reglaRenovacion(ctx.licencia, fechaBogota(ctx.ahora), nuevas);
		if (!r.ok) return r;
		const lic = ctx.licencia!;
		const fechas = {
			vigenciaActualHasta: lic.end_date,
			nuevaVigenciaDesde: r.desde,
			nuevaVigenciaHasta: r.hasta,
			modo: r.modo,
			diasRestantes: r.diasRestantes,
		};

		if (!nuevas) {
			const plan = r.plan!;
			if (e.plan && e.plan !== plan) {
				return mal(409, 'renovacion_desactualizada', 'Tu plan cambió. Recarga la página.');
			}
			const cat = CATALOGO_BASE_2026;
			const extras = Math.max(0, r.empresas - cat.planes[plan].empresas);
			const total = precioAnual(cat, plan, r.empresas);
			return {
				ok: true,
				montoCents: montoRenovacionCents(plan, r.empresas),
				toleranciaCents: 0,
				desglose: {
					flujo: 'renovacion',
					plan: cat.planes[plan].nombre,
					planCodigo: plan,
					planAnterior: lic.license_type,
					empresas: r.empresas,
					precioPlan: cat.planes[plan].precio,
					empresasAdicionales: extras,
					precioAdicionales: extras * cat.empresaAdicional,
					precioLista: total,
					fundador: false,
					paso: null,
					catalogo: cat.id,
					...fechas,
					total,
				},
			};
		}

		const q = ctx.renovacion;
		if (!q || q.reglas !== 'nov-2026') {
			return mal(503, 'cotizacion_no_disponible', 'No pudimos calcular el precio de tu renovación. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.');
		}
		if (q.resultado === 'manual') return mal(409, 'renovacion_manual', mensajeRenovacionManual(q));
		if (e.plan && e.plan !== q.plan_codigo && e.plan !== codigoPlanRenovacion(lic.license_type)) {
			return mal(409, 'renovacion_desactualizada', 'Tu plan cambió. Recarga la página.');
		}
		return {
			ok: true,
			montoCents: q.precio! * 100,
			toleranciaCents: 0,
			desglose: {
				flujo: 'renovacion',
				plan: q.plan,
				planCodigo: q.plan_codigo,
				planAnterior: lic.license_type,
				cambioDePlan: q.plan !== lic.license_type,
				empresas: q.cupo,
				empresasRegistradas: q.empresas_registradas,
				precioPlan: q.precio_plan ?? q.precio,
				empresasAdicionales: q.empresas_adicionales,
				precioAdicionales: q.precio_adicionales,
				precioLista: q.precio_lista,
				fundador: q.fundador,
				paso: q.paso,
				catalogo: q.reglas,
				...fechas,
				total: q.precio!,
			},
		};
	}

	const lic = ctx.licencia;
	if (!lic) return mal(409, 'sin_licencia', 'No tienes un plan activo.');
	const actual = codigoPlan(lic.license_type);
	const cat = catalogoDeLicencia(lic);

	if (e.flujo === 'upgrade') {
		if (!actual || ORDEN_PLANES.indexOf(e.plan) <= ORDEN_PLANES.indexOf(actual)) {
			return mal(400, 'no_es_upgrade', 'Solo puedes subir a un plan superior.');
		}
		const u = montoUpgrade(cat, lic, actual, e.plan, ctx.ahora);
		return {
			ok: true,
			montoCents: u.monto * 100,
			toleranciaCents: u.tolerancia * 100,
			desglose: {
				flujo: 'upgrade',
				plan: cat.planes[e.plan].nombre,
				planActual: lic.license_type,
				diasRestantes: u.diasRestantes,
				totalDias: u.totalDias,
				credito: u.credito,
				proporcional: u.proporcional,
				cupoNuevo: Math.max(Number(lic.companies_number ?? 0), cat.planes[e.plan].empresas),
				catalogo: cat.id,
				total: u.monto,
			},
		};
	}

	const r = reglaExtras(lic.license_type, e.cantidad);
	if (!r.ok) return { ...r, status: 400 };
	const x = montoExtras(cat, lic, r.cantidad, ctx.ahora);
	return {
		ok: true,
		montoCents: x.monto * 100,
		toleranciaCents: x.tolerancia * 100,
		desglose: {
			flujo: 'extras',
			plan: lic.license_type,
			cantidad: r.cantidad,
			precioUnitario: cat.empresaAdicional,
			diasRestantes: x.diasRestantes,
			totalDias: x.totalDias,
			cupoNuevo: Number(lic.companies_number ?? 0) + r.cantidad,
			catalogo: cat.id,
			total: x.monto,
		},
	};
}

/**
 * Cómo compara el webhook lo que llegó con lo esperado. Registro y compra
 * exigen el monto EXACTO; upgrade y extras admiten la tolerancia hacia abajo.
 */
export function compararMonto(
	recibidoCents: number,
	esperadoCents: number,
	toleranciaCents: number,
): 'exacto' | 'mayor' | 'insuficiente' {
	if (!Number.isSafeInteger(recibidoCents)) return 'insuficiente';
	if (recibidoCents < esperadoCents - toleranciaCents) return 'insuficiente';
	if (recibidoCents > esperadoCents) return 'mayor';
	return 'exacto';
}

// ── Firma de integridad ─────────────────────────────────────────────────

export async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA256(referencia + montoEnCentavos + moneda [+ expirationTime] + secreto),
 * la fórmula de Wompi. Nunca se registra ni la llave ni la firma.
 */
export function firmaIntegridad(
	referencia: string,
	montoCents: number,
	moneda: string,
	expiracion: string | null,
	llave: string,
): Promise<string> {
	if (!llave) throw new Error('llave de integridad vacía');
	if (!Number.isSafeInteger(montoCents) || montoCents <= 0) throw new Error('monto inválido');
	return sha256Hex(`${referencia}${montoCents}${moneda}${expiracion ?? ''}${llave}`);
}

/** sha256 del correo en minúsculas: cupon_canjes nunca guarda el correo. */
export function hashCorreo(email: string): Promise<string> {
	return sha256Hex(String(email).trim().toLowerCase());
}

export function correoValido(x: unknown): x is string {
	return typeof x === 'string' && x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim());
}

// ── Cupones ─────────────────────────────────────────────────────────────

export type MotivoCupon = 'inexistente' | 'inactivo' | 'vencido' | 'agotado' | 'ya_usado' | 'otro_plan';

/** Mensaje único al cliente: no revela si el código existe. */
export const MENSAJE_CUPON_INVALIDO = 'Cupón inválido o vencido.';

export interface FilaCupon {
	id: string;
	code: string;
	discount_percent: number;
	is_active: boolean | null;
	vence_at?: string | null;
	max_usos?: number | null;
	un_uso_por_cliente?: boolean | null;
	/** Si viene, el cupón solo vale para este plan (código: PYME, CONT…). */
	solo_plan?: string | null;
}

/** Regla pura: null si el cupón se puede usar. */
export function evaluarCupon(
	c: FilaCupon,
	uso: { usos: number; yaUsadoPorCliente: boolean; plan?: string | null },
	ahora: Date,
): Exclude<MotivoCupon, 'inexistente'> | null {
	if (!c.is_active) return 'inactivo';
	// Sin saber el plan no se aprueba: un cupón con candado nunca vale a ciegas.
	if (c.solo_plan && uso.plan !== c.solo_plan) return 'otro_plan';
	if (c.vence_at && Date.parse(c.vence_at) <= ahora.getTime()) return 'vencido';
	if (c.max_usos != null && uso.usos >= c.max_usos) return 'agotado';
	if (c.un_uso_por_cliente !== false && uso.yaUsadoPorCliente) return 'ya_usado';
	return null;
}

export type ResultadoCupon =
	| { existe: false; motivo: 'inexistente' }
	| { existe: true; id: string; code: string; pct: number; unoPorCliente: boolean; motivo: Exclude<MotivoCupon, 'inexistente'> | null };

/**
 * Lee el cupón y sus canjes con service role. `referencia` excluye el canje
 * del mismo pago (reintentos del webhook). Lanza si la base falla: quien
 * llama decide (preparar-pago responde 500; el webhook, 500 para reintento).
 */
// deno-lint-ignore no-explicit-any
export async function validarCupon(admin: any, code: string, opts: {
	emailHash: string | null;
	referencia?: string | null;
	ahora: Date;
	/** El plan que se está pagando (código). Lo exige un cupón con `solo_plan`. */
	plan?: string | null;
}): Promise<ResultadoCupon> {
	const { data: c, error } = await admin.from('coupons')
		.select('id, code, discount_percent, is_active, vence_at, max_usos, un_uso_por_cliente, solo_plan')
		.eq('code', code).maybeSingle();
	if (error) throw new Error(`lectura de coupons falló: ${error.message}`);
	if (!c) return { existe: false, motivo: 'inexistente' };

	let usos = 0;
	if (c.max_usos != null) {
		let q = admin.from('cupon_canjes').select('id', { count: 'exact', head: true }).eq('coupon_id', c.id);
		if (opts.referencia) q = q.neq('referencia', opts.referencia);
		const { count, error: e2 } = await q;
		if (e2) throw new Error(`conteo de canjes falló: ${e2.message}`);
		usos = count ?? 0;
	}

	let yaUsado = false;
	if (c.un_uso_por_cliente !== false && opts.emailHash) {
		let q = admin.from('cupon_canjes').select('id').eq('coupon_id', c.id)
			.eq('email_hash', opts.emailHash).eq('unico', true);
		if (opts.referencia) q = q.neq('referencia', opts.referencia);
		const { data: filas, error: e3 } = await q.limit(1);
		if (e3) throw new Error(`lectura de canjes falló: ${e3.message}`);
		yaUsado = (filas ?? []).length > 0;
	}

	const pct = Number(c.discount_percent);
	return {
		existe: true,
		id: c.id,
		code: c.code,
		pct: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
		unoPorCliente: c.un_uso_por_cliente !== false,
		motivo: evaluarCupon(c as FilaCupon, { usos, yaUsadoPorCliente: yaUsado, plan: opts.plan }, opts.ahora),
	};
}

/**
 * Registra el uso del cupón. El índice único parcial (coupon_id, email_hash)
 * WHERE unico hace atómica la regla de un uso por cliente; UNIQUE(referencia)
 * vuelve idempotente el reintento del mismo pago.
 */
// deno-lint-ignore no-explicit-any
export async function registrarCanje(admin: any, fila: {
	coupon_id: string;
	email_hash: string;
	user_id: string | null;
	referencia: string;
	tx_id: string | null;
	flujo: string;
	monto_cents: number;
	unico: boolean;
}): Promise<{ ok: true; duplicado: boolean } | { ok: false; motivo: 'ya_usado' | 'error'; mensaje: string }> {
	const { error } = await admin.from('cupon_canjes').insert(fila);
	if (!error) return { ok: true, duplicado: false };
	if (error.code === '23505') {
		if (/referencia/.test(String(error.message))) return { ok: true, duplicado: true };
		return { ok: false, motivo: 'ya_usado', mensaje: error.message };
	}
	return { ok: false, motivo: 'error', mensaje: error.message };
}

// ── Pagos preparados ────────────────────────────────────────────────────
//
// preparar-pago guarda cada referencia que firma, con su monto. El webhook
// exige esa fila en REG3 y REN2 (y la usa en PUR2, UPG2 y ADD2): así una referencia
// firmada con la llave de integridad vieja (que estuvo en el JS público) no
// puede inventar un cupón, un plan o un monto. Ver docs/pagos/DESPLIEGUE.md.

export type FlujoPreparado = 'registro' | 'compra' | 'upgrade' | 'extras' | 'renovacion' | FlujoMensual;

export interface PagoPreparado {
	referencia: string;
	flujo: FlujoPreparado;
	monto_cents: number;
}

/**
 * Lo que preparar-pago vio al cotizar un flujo del mensual (columna
 * pagos_preparados.esperado, migración 20261104130000): la licencia que se
 * iba a extender o reemplazar y lo que se descontó. La base lo compara al
 * aplicar (p_licencia_esperada) y avisa si cambió (cotizacion_cambio).
 */
export interface EsperadoMensual {
	license_id: string | null;
	end_date: string | null;
	modo?: 'nueva' | 'extension' | null;
	credito_cents?: number | null;
}

/** Lanza si la base falla: sin esa fila no se firma. */
// deno-lint-ignore no-explicit-any
export async function registrarPreparado(admin: any, fila: PagoPreparado & {
	coupon_id: string | null;
	user_id: string | null;
	email_hash: string | null;
	expira_at: string;
	/** Solo los flujos del mensual (la columna no existe antes de 20261104130000). */
	esperado?: EsperadoMensual;
}): Promise<void> {
	const { error } = await admin.from('pagos_preparados').insert(fila);
	if (error) throw new Error(`no se pudo registrar el pago preparado: ${error.message}`);
}

/** null si preparar-pago no emitió esa referencia. Lanza si la base falla. */
// deno-lint-ignore no-explicit-any
export async function leerPreparado(admin: any, referencia: string): Promise<PagoPreparado | null> {
	const { data, error } = await admin.from('pagos_preparados')
		.select('referencia, flujo, monto_cents').eq('referencia', referencia).maybeSingle();
	if (error) throw new Error(`lectura de pagos_preparados falló: ${error.message}`);
	return data ? { referencia: data.referencia, flujo: data.flujo, monto_cents: Number(data.monto_cents) } : null;
}

const RE_UUID_TEXTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `esperado` de un pago del mensual (null si no hay o no tiene forma). Solo
 * se lee en los flujos del mensual, que no existen sin la columna. Lanza si
 * la base falla.
 */
// deno-lint-ignore no-explicit-any
export async function leerEsperado(admin: any, referencia: string): Promise<EsperadoMensual | null> {
	const { data, error } = await admin.from('pagos_preparados')
		.select('esperado').eq('referencia', referencia).maybeSingle();
	if (error) throw new Error(`lectura de pagos_preparados.esperado falló: ${error.message}`);
	const e = data?.esperado;
	if (!e || typeof e !== 'object') return null;
	return {
		license_id: typeof e.license_id === 'string' && RE_UUID_TEXTO.test(e.license_id) ? e.license_id : null,
		end_date: typeof e.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.end_date) ? e.end_date : null,
		modo: e.modo === 'nueva' || e.modo === 'extension' ? e.modo : null,
		credito_cents: Number.isSafeInteger(e.credito_cents) ? e.credito_cents : null,
	};
}

/**
 * Qué hace el webhook con un pago según la fila de preparar-pago:
 *  - 'no_emitida': la referencia no salió de preparar-pago (o es de otro flujo).
 *  - 'monto_distinto': salió de ahí, pero se pagó otro monto (firma forjada
 *    sobre una referencia real).
 *  - 'emitida': monto y flujo coinciden con lo que firmó el servidor.
 *  - 'sin_fila': no hay fila y el flujo admite el JS viejo (reglas estrictas).
 */
export function evaluarPreparado(
	prep: PagoPreparado | null,
	flujo: FlujoPreparado,
	recibidoCents: number,
	exigir: boolean,
): 'emitida' | 'no_emitida' | 'monto_distinto' | 'sin_fila' {
	if (!prep) return exigir ? 'no_emitida' : 'sin_fila';
	if (prep.flujo !== flujo) return 'no_emitida';
	return prep.monto_cents === recibidoCents ? 'emitida' : 'monto_distinto';
}

// ── Límite de intentos (preparar-pago anónimo) ──────────────────────────

/** Llamadas anónimas por IP y ventana: frena el oráculo de cupones y de correos. */
export const LIMITE_INTENTOS = { max: 20, ventanaSeg: 600 } as const;

/**
 * IP del cliente para el límite. cf-connecting-ip y x-real-ip los fija el
 * proxy; el primer x-forwarded-for lo puede inventar el cliente, así que es
 * el último recurso. null: no se limita.
 */
export function ipCliente(h: Headers): string | null {
	const ip = h.get('cf-connecting-ip') || h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0];
	const limpia = String(ip || '').trim();
	return limpia && limpia.length <= 64 ? limpia : null;
}

// ── Lectura de la licencia (preparar-pago y wompi-webhook) ──────────────

const COLUMNAS_LICENCIA = 'id, license_type, companies_number, start_date, end_date, is_active';

/** La columna no existe (migración 20261003100000 aún sin aplicar): 42703 en Postgres/PostgREST. */
export function esColumnaInexistente(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
	if (!error) return false;
	if (String(error.code ?? '') === '42703') return true;
	return /column .*periodo_desde.* does not exist/i.test(String(error.message ?? ''));
}

/**
 * Licencia del usuario con service role.
 *  - 'activa': la fila activa (upgrade, extras, compra y registro).
 *  - 'ultima': la activa o, si no hay, la que vence más tarde (renovación).
 * Lee periodo_desde; si la columna aún no existe en la base, repite sin ella
 * (el prorrateo queda como antes). Lanza si la base falla.
 */
// deno-lint-ignore no-explicit-any
export async function leerLicencia(admin: any, uid: string, cual: 'activa' | 'ultima') {
	const consulta = (columnas: string) => {
		let q = admin.from('licenses').select(columnas).eq('user_id', uid);
		q = cual === 'activa'
			? q.eq('is_active', true).order('created_at', { ascending: false })
			// Mismo orden que licencia_aplicar_renovacion (migración 20261003100000):
			// is_active desc nulls last, end_date desc, created_at desc nulls last.
			: q.order('is_active', { ascending: false, nullsFirst: false })
				.order('end_date', { ascending: false })
				.order('created_at', { ascending: false, nullsFirst: false });
		return q.limit(1).maybeSingle();
	};
	// Con las columnas del mensual (migración 20261104120000 de la app); si la
	// base aún no las tiene, como antes (y la fila se toma por anual).
	let { data, error } = await consulta(`${COLUMNAS_LICENCIA}, periodo_desde, ${COLUMNAS_MENSUAL}`);
	if (error && esColumnaInexistente(error)) ({ data, error } = await consulta(`${COLUMNAS_LICENCIA}, periodo_desde`));
	if (error && esColumnaInexistente(error)) ({ data, error } = await consulta(COLUMNAS_LICENCIA));
	if (error) throw new Error(`lectura de licencia falló: ${error.message}`);
	return data ?? null;
}

const COLUMNAS_MENSUAL = 'es_prueba, periodicidad, ventana_desde, al_dia_hasta';

/** La base no tiene las columnas o las funciones del mensual: los flujos nuevos no se cobran. */
export class MensualNoInstalado extends Error {
	constructor(que: string) {
		super(`plan mensual sin migrar (${que})`);
		this.name = 'MensualNoInstalado';
	}
}

/**
 * Licencia ACTIVA más reciente con las columnas del mensual, para los cuatro
 * flujos nuevos (el mismo orden que get_active_license y que las RPC del
 * mensual: is_active, end_date desc). Sin las columnas lanza
 * MensualNoInstalado (preparar-pago responde 503): sin ellas no se puede
 * validar la ventana. Lanza si la base falla.
 */
// deno-lint-ignore no-explicit-any
export async function leerLicenciaMensual(admin: any, uid: string): Promise<LicenciaParaRenovar | null> {
	const { data, error } = await admin.from('licenses')
		.select(`${COLUMNAS_LICENCIA}, periodo_desde, ${COLUMNAS_MENSUAL}`)
		.eq('user_id', uid).eq('is_active', true)
		.order('end_date', { ascending: false })
		.limit(1).maybeSingle();
	if (error) {
		if (esColumnaInexistente(error)) throw new MensualNoInstalado('licenses');
		throw new Error(`lectura de licencia falló: ${error.message}`);
	}
	return data ?? null;
}

/**
 * Lo ya pagado del periodo mensual que aún no se usa y se descuenta al pasar al
 * anual (centavos), según el libro licencia_mensual_movimientos, POR DÍAS: del
 * bloque en curso, los días desde hoy hasta su fin; los bloques futuros ya
 * pagados, completos; y Ponerse al día comprado en el bloque en curso. Lo calcula la base (public.licencia_mensual_credito, una sola fuente
 * con licencia_pasar_a_anual). Sin la RPC lanza MensualNoInstalado.
 */
// deno-lint-ignore no-explicit-any
export async function creditoAnualizar(admin: any, uid: string, hoy: string): Promise<{ licenseId: string | null; creditoCents: number }> {
	const { data, error } = await admin.rpc('licencia_mensual_credito', { p_user_id: uid, p_hoy: hoy });
	if (error) {
		if (esFuncionInexistente(error)) throw new MensualNoInstalado('licencia_mensual_credito');
		throw new Error(`licencia_mensual_credito falló: ${error.message}`);
	}
	const c = entero(data?.credito_centavos);
	if (c === null || c < 0) throw new Error('licencia_mensual_credito respondió sin la forma esperada');
	const id = typeof data?.license_id === 'string' && RE_UUID_TEXTO.test(data.license_id) ? data.license_id : null;
	return { licenseId: id, creditoCents: c };
}

// ── Prueba de la autorización (public.consentimientos) ──────────────────
//
// Los flujos del mensual con sesión (Mi cuenta) guardan la prueba de la
// autorización de tratamiento de datos DESDE EL SERVIDOR antes de firmar (Ley
// 1581, art. 9; DUR 1074 de 2015, art. 2.2.2.25.2.5): con el uid del JWT, el
// correo de la cuenta y la versión de la Política que tiene el SERVIDOR. Si no
// se puede guardar, no se firma (falla cerrada). meta_capi va siempre en
// false: en Mi cuenta no hay casilla de Meta.

/** Versión vigente de la Política (/privacidad). Igual a POLICY_VERSION de src/lib/legal.ts (pagos_test.ts). */
export const VERSION_POLITICA = '2026-11-16';

/** Origen de la fila de consentimientos de cada flujo del mensual con sesión. */
export function origenConsentimientoMensual(flujo: 'mensual' | 'al_dia' | 'anualizar'): 'compra' | 'upgrade' {
	return flujo === 'anualizar' ? 'upgrade' : 'compra';
}

/** Inserta la prueba de la autorización. Lanza si no se pudo guardar (incluida la tabla sin migrar). */
// deno-lint-ignore no-explicit-any
export async function registrarConsentimientoServidor(admin: any, fila: {
	origen: 'compra' | 'upgrade';
	referencia: string;
	email: string | null;
	user_id: string;
}): Promise<void> {
	const { error } = await admin.from('consentimientos').insert({
		origen: fila.origen,
		version_politica: VERSION_POLITICA,
		referencia: fila.referencia,
		email: fila.email ? fila.email.trim().toLowerCase() : null,
		user_id: fila.user_id,
		terminos: true,
		tratamiento_datos: true,
		meta_capi: false,
		comunicaciones_comerciales: false,
	});
	if (error) throw new Error(`consentimiento no guardado: ${error.code ?? ''} ${error.message ?? ''}`.trim());
}

// ── Renovación en curso (preparar-pago) ─────────────────────────────────
//
// La licencia no cambia hasta que el webhook aplica la renovación: segundos
// después de un pago APROBADO, o minutos/días después de uno PENDIENTE (PSE,
// corresponsal). Mientras tanto la ventana sigue abierta y, desde otro
// navegador, se podría firmar y pagar OTRA SA-REN2. El webhook la rechaza
// (renovacion_fuera_de_ventana), pero el cobro ya ocurrió y el reembolso es
// manual. Por eso, antes de cotizar o firmar una renovación, se le pregunta a
// Wompi por las SA-REN2 que este usuario firmó en los últimos días.
// Wompi no manda eventos de PENDING: solo su API los ve.
// Límite conocido: dos widgets abiertos a la vez y pagados en los mismos
// segundos siguen pasando los dos (queda la defensa del webhook).

/** Cuánto hacia atrás se miran las SA-REN2 firmadas (un corresponsal puede tardar días). */
export const VENTANA_RENOVACION_EN_CURSO_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de referencias consultadas a Wompi por llamada. */
export const MAX_REFERENCIAS_EN_CURSO = 10;

export interface TxWompi {
	reference: string;
	status: string;
}

export interface RenovacionEnCurso {
	estado: 'APPROVED' | 'PENDING';
	referencia: string;
}

/**
 * Un APROBADO que el webhook todavía no aplicó manda sobre un PENDIENTE.
 * DECLINED, VOIDED y ERROR no cuentan: se puede volver a pagar.
 */
export function evaluarRenovacionEnCurso(txs: TxWompi[], aplicadas: Set<string>): RenovacionEnCurso | null {
	let pendiente: RenovacionEnCurso | null = null;
	for (const t of txs) {
		if (t.status === 'APPROVED' && !aplicadas.has(t.reference)) {
			return { estado: 'APPROVED', referencia: t.reference };
		}
		if (t.status === 'PENDING' && !pendiente) pendiente = { estado: 'PENDING', referencia: t.reference };
	}
	return pendiente;
}

export function mensajeRenovacionEnCurso(e: RenovacionEnCurso): string {
	return e.estado === 'APPROVED'
		? 'Ya recibimos el pago de esta renovación y se aplicará en unos minutos. No hace falta pagar otra vez; si en un par de horas no la ves, escríbenos por WhatsApp.'
		: 'Ya hay un pago de esta renovación pendiente de confirmación. Si se aprueba, la renovación se aplica sola. No hace falta pagar otra vez; si tienes dudas, escríbenos por WhatsApp.';
}

/** Transacciones de Wompi con esa referencia (API con la llave privada). Lanza si Wompi no responde bien. */
export async function consultarTransaccionesWompi(
	apiUrl: string,
	llavePrivada: string,
	referencia: string,
	fetchFn: typeof fetch = fetch,
): Promise<TxWompi[]> {
	const url = `${apiUrl.replace(/\/+$/, '')}/transactions?reference=${encodeURIComponent(referencia)}`;
	const res = await fetchFn(url, {
		headers: { Authorization: `Bearer ${llavePrivada}` },
		signal: AbortSignal.timeout(8000),
	});
	if (!res.ok) throw new Error(`Wompi respondió ${res.status} al consultar transacciones`);
	const cuerpo = await res.json();
	if (!Array.isArray(cuerpo?.data)) throw new Error('Wompi respondió sin data al consultar transacciones');
	return cuerpo.data
		.map((t: { reference?: unknown; status?: unknown }) => ({ reference: String(t?.reference ?? ''), status: String(t?.status ?? '') }))
		.filter((t: TxWompi) => t.reference === referencia);
}

/**
 * La SA-REN2 de este usuario que ya está pagada (sin aplicar) o pendiente, o
 * null. Solo llama a Wompi si hay referencias recientes. Lanza si la base o
 * Wompi fallan: quien llama no firma sin saberlo.
 */
export async function buscarRenovacionEnCurso(
	// deno-lint-ignore no-explicit-any
	admin: any,
	uid: string,
	ahora: Date,
	consultar: (referencia: string) => Promise<TxWompi[]>,
): Promise<RenovacionEnCurso | null> {
	const desde = new Date(ahora.getTime() - VENTANA_RENOVACION_EN_CURSO_MS).toISOString();
	const { data, error } = await admin.from('pagos_preparados')
		.select('referencia')
		.eq('user_id', uid)
		.eq('flujo', 'renovacion')
		.gte('creado_at', desde)
		.order('creado_at', { ascending: false })
		.limit(MAX_REFERENCIAS_EN_CURSO);
	if (error) throw new Error(`lectura de pagos_preparados falló: ${error.message}`);
	const refs: string[] = (data ?? []).map((f: { referencia: string }) => f.referencia);
	if (refs.length === 0) return null;

	const txs = (await Promise.all(refs.map((r) => consultar(r)))).flat();
	if (!txs.some((t) => t.status === 'APPROVED' || t.status === 'PENDING')) return null;

	const { data: ap, error: errAp } = await admin.from('licencia_renovaciones')
		.select('referencia')
		.in('referencia', refs);
	if (errAp) throw new Error(`lectura de licencia_renovaciones falló: ${errAp.message}`);
	const aplicadas = new Set<string>((ap ?? []).map((f: { referencia: string }) => f.referencia));
	return evaluarRenovacionEnCurso(txs, aplicadas);
}

// ── Causación: SOLO PARA MOSTRAR (Entrega 5, docs/pagos/PLAN-MENSUAL.md de la app) ──
// Ninguna Edge las usa para cobrar: lo incluido lo cuenta la base de la app
// (causacion_cupo_*) y el cobro lo fija Trevol (069_billetera_causacion.sql,
// lista «causación»). Las lee el bot (meta-bot, copia de este archivo) para
// contestar con las cifras del sitio. pagos_test.ts exige que coincidan con
// src/lib/pricing.ts.

/** Causaciones gratis al mes por cada empresa (NIT) de una cuenta con licencia vigente,
 *  sumando todas las cuentas que la tienen en su plan. 10 desde el 2026-11-12 (antes 40). */
export const INCLUIDAS_POR_EMPRESA = 10;

/** Causaciones gratis por empresa (NIT) sin licencia: 0 desde el 2026-11-14 (decisión del dueño):
 *  sin plan, cada causación se paga con el saldo. Antes, 10 de por vida (2026-11-12). */
export const GRATIS_SIN_PLAN_POR_EMPRESA = 0;

/** Meses tras los que vence cada recarga del saldo de Trevol (027_vencimiento_saldo.sql,
 *  cobro.config.vence_meses). Solo para mostrar: nunca «que no vence». */
export const VENCE_SALDO_MESES = 12;

/** Precio por causación COBRADA del saldo, según cuántas cobradas lleve la cuenta en el mes
 *  (hora Bogotá, todas sus empresas). Sin tramo gratis: las gratis no cuentan aquí. Es lo que
 *  paga el cliente de SisteAcuse (Trevol con with_plan=true, decisión del 2026-11-12); ya no la
 *  tabla cruda de Trevol (1–20 a $0, 21–100 $900, …). */
export const TRAMOS_CAUSACION: readonly { desde: number; hasta: number | null; precio: number }[] = [
	{ desde: 1, hasta: 80, precio: 900 },
	{ desde: 81, hasta: 480, precio: 750 },
	{ desde: 481, hasta: 980, precio: 500 },
	{ desde: 981, hasta: 2980, precio: 350 },
	{ desde: 2981, hasta: null, precio: 250 },
];

// Entorno controlado de las pruebas E2E.
//
// El sitio se compiló con VITE_SUPABASE_URL=http://supabase.prueba.local, un
// host que no existe. Aquí:
//   - el backend (Supabase) responde con un doble de prueba que registra cada
//     llamada, para poder verificar QUÉ envía el sitio. En la Edge Function
//     preparar-pago, el monto y la validez del cupón salen de las funciones
//     reales del servidor (sut/sitio-pagos/pagos.ts): cotizar(),
//     normalizarCupon() y evaluarCupon(). Lo simulado es: la tabla de cupones
//     y sus usos, la firma de integridad, la verificación de «ya tiene
//     cuenta» (una prueba la fuerza con errorDePagos) y la tabla checkouts
//     (siempre responde 201);
//   - la pasarela Wompi se reemplaza por un widget falso que no cobra nada y
//     devuelve el resultado que la prueba elija (APPROVED, DECLINED…);
//   - cualquier otra petición externa (analítica, Meta, YouTube…) se bloquea.
// Así ninguna prueba puede tocar producción ni hacer un cobro real.

import { test as base, expect } from '@playwright/test';
import {
	codigoPlan,
	cotizar,
	evaluarCupon,
	type FilaCupon,
	MENSAJE_CUPON_INVALIDO,
	normalizarCupon
} from '../../sut/sitio-pagos/pagos';

export const HOST_BACKEND = 'supabase.prueba.local';

/** El instante en que corren las pruebas del registro, en el navegador y en el servidor. */
export const HOY = new Date('2026-11-22T10:00:00-05:00');

/** Versión de la Política de datos del sitio compilado (POLICY_VERSION de src/lib/legal.ts). */
const POLITICA_DE_DATOS = '2026-11-16';

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS'
};

export type Llamada = { metodo: string; ruta: string; cuerpo: any };
export type Respuesta = { status: number; cuerpo: unknown };

export type Backend = {
	llamadas: Llamada[];
	/** Respuesta de la Edge Function preparar-pago (por defecto: cotiza sin cupón y firma). */
	prepararPago: (cuerpo: any) => Respuesta;
	/** Lo que el widget de Wompi devuelve al «pagar». null = la persona cerró el widget. */
	resultadoWompi: string | null;
	llamadasA: (ruta: string) => Llamada[];
};

/**
 * preparar-pago con la lógica real del servidor: normaliza y evalúa el cupón
 * con normalizarCupon() y evaluarCupon(), cotiza con cotizar() y, si no es solo
 * una cotización, «firma» el pago.
 *
 * `cupones` simula la tabla de cupones de la base: código → porcentaje, o la
 * fila completa (vencimiento, candado de plan, usos…). Un código que no está
 * es inexistente. `montoFirmadoCents` permite que el servidor firme un monto
 * distinto al cotizado, para comprobar que el sitio cobra el del servidor.
 */
export function servidorDePagos(
	cupones: Record<string, number | Partial<FilaCupon>> = {},
	opciones: { montoFirmadoCents?: number; usos?: Record<string, number> } = {}
) {
	const fila = (codigo: string): FilaCupon | null => {
		const dato = cupones[codigo];
		if (dato === undefined) return null;
		const base = { id: `cupon-${codigo}`, code: codigo, discount_percent: 0, is_active: true };
		return typeof dato === 'number' ? { ...base, discount_percent: dato } : { ...base, ...dato };
	};
	const rechazoCupon: Respuesta = { status: 400, cuerpo: { ok: false, codigo: 'cupon', error: MENSAJE_CUPON_INVALIDO } };

	return (pedido: any): Respuesta => {
		const plan = codigoPlan(pedido?.plan);
		if (!plan) return { status: 400, cuerpo: { ok: false, codigo: 'plan_invalido', error: 'Plan inválido.' } };

		let cupon: string | null = null;
		let pct = 0;
		if (pedido.cupon !== null && pedido.cupon !== undefined) {
			cupon = normalizarCupon(pedido.cupon);
			const f = cupon ? fila(cupon) : null;
			if (!f) return rechazoCupon;
			const uso = { usos: opciones.usos?.[cupon!] ?? 0, yaUsadoPorCliente: false, plan };
			if (evaluarCupon(f, uso, HOY) !== null) return rechazoCupon;
			pct = f.discount_percent;
		}

		const c = cotizar({ flujo: 'registro', plan }, { ahora: HOY, cuponPct: pct, cupon });
		if (!c.ok) return { status: c.status, cuerpo: { ok: false, codigo: c.codigo, error: c.mensaje } };
		if (pedido.solo_cotizar) return { status: 200, cuerpo: { ok: true, gratis: false, desglose: c.desglose } };
		const monto = opciones.montoFirmadoCents ?? c.montoCents;
		return {
			status: 200,
			cuerpo: {
				ok: true,
				gratis: monto === 0,
				desglose: c.desglose,
				referencia: `SA-REG3-${plan}-${cupon ?? 0}-1795398288-prueba`,
				amountInCents: monto,
				currency: 'COP',
				firma: 'firma-de-prueba',
				publicKey: 'pub_test_prueba'
			}
		};
	};
}

/** Respuesta de error de preparar-pago con un estado y un código dados. */
export function errorDePagos(status: number, codigo: string, error: string): Respuesta {
	return { status, cuerpo: { ok: false, codigo, error } };
}

export const test = base.extend<{ backend: Backend }>({
	backend: async ({ context }, use) => {
		const backend: Backend = {
			llamadas: [],
			prepararPago: servidorDePagos(),
			resultadoWompi: 'APPROVED',
			llamadasA: (ruta) => backend.llamadas.filter((l) => l.ruta.endsWith(ruta))
		};

		// La persona ya rechazó las cookies opcionales: el aviso no aparece (tapaba
		// el formulario en las capturas) y no se carga analítica.
		await context.addInitScript((politica) => {
			const eleccion = { v: 1, policy: politica, analytics: false, ads: false, ts: Date.now() };
			window.localStorage.setItem('sa_consent', JSON.stringify(eleccion));
		}, POLITICA_DE_DATOS);

		await context.route('**/*', async (route) => {
			const req = route.request();
			const url = new URL(req.url());

			if (url.hostname === 'localhost') return route.continue();

			if (url.hostname === 'checkout.wompi.co' && url.pathname === '/widget.js') {
				return route.fulfill({ contentType: 'text/javascript', body: widgetFalso(backend.resultadoWompi) });
			}

			if (url.hostname === HOST_BACKEND) {
				if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
				let cuerpo: any = req.postData();
				try {
					cuerpo = cuerpo ? JSON.parse(cuerpo) : null;
				} catch {
					/* se deja como texto */
				}
				backend.llamadas.push({ metodo: req.method(), ruta: url.pathname, cuerpo });

				const respuesta: Respuesta = url.pathname.endsWith('/functions/v1/preparar-pago')
					? backend.prepararPago(cuerpo)
					: { status: 201, cuerpo: null };
				return route.fulfill({
					status: respuesta.status,
					headers: CORS,
					contentType: 'application/json',
					body: respuesta.cuerpo === null ? '' : JSON.stringify(respuesta.cuerpo)
				});
			}

			return route.abort('blockedbyclient');
		});

		await use(backend);
	}
});

/** Widget de Wompi falso: guarda la configuración y responde con el estado pedido. */
function widgetFalso(estado: string | null): string {
	return `
		window.WidgetCheckout = class {
			constructor(config) { window.__wompi = { config, abierto: false }; }
			open(alTerminar) {
				window.__wompi.abierto = true;
				window.__aperturasWompi = (window.__aperturasWompi ?? 0) + 1;
				const estado = ${JSON.stringify(estado)};
				setTimeout(() => alTerminar(estado
					? { transaction: { id: 'tx-prueba', status: estado, reference: window.__wompi.config.reference } }
					: { transaction: null }), 50);
			}
		};`;
}

export { expect };

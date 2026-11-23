// Entorno controlado de las pruebas E2E.
//
// El sitio se compiló con VITE_SUPABASE_URL=http://supabase.prueba.local, un
// host que no existe. Aquí:
//   - el backend (Supabase) responde con un doble de prueba que registra cada
//     llamada, para poder verificar QUÉ envía el sitio. La Edge Function
//     preparar-pago no se inventa: el doble cotiza con cotizar(), la misma
//     función del servidor (sut/sitio-pagos/pagos.ts); lo único simulado es la
//     base de datos (cupones) y la firma;
//   - la pasarela Wompi se reemplaza por un widget falso que no cobra nada y
//     devuelve el resultado que la prueba elija (APPROVED, DECLINED…);
//   - cualquier otra petición externa (analítica, Meta, YouTube…) se bloquea.
// Así ninguna prueba puede tocar producción ni hacer un cobro real.

import { test as base, expect } from '@playwright/test';
import { codigoPlan, cotizar } from '../../sut/sitio-pagos/pagos';

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
 * preparar-pago con la lógica real del servidor: cotiza con cotizar() y, si no
 * es solo una cotización, «firma» el pago. `cupones` simula la tabla de cupones
 * de la base de datos: código → porcentaje (un código que no está es inválido).
 */
export function servidorDePagos(cupones: Record<string, number> = {}) {
	return (pedido: any): Respuesta => {
		const plan = codigoPlan(pedido?.plan);
		if (!plan) return { status: 400, cuerpo: { ok: false, codigo: 'plan_invalido', error: 'Plan inválido.' } };
		const cupon = pedido.cupon ?? null;
		if (cupon !== null && !(cupon in cupones)) {
			return { status: 400, cuerpo: { ok: false, codigo: 'cupon', error: 'Cupón inválido o vencido.' } };
		}
		const c = cotizar({ flujo: 'registro', plan }, { ahora: HOY, cuponPct: cupon ? cupones[cupon] : 0, cupon });
		if (!c.ok) return { status: c.status, cuerpo: { ok: false, codigo: c.codigo, error: c.mensaje } };
		if (pedido.solo_cotizar) return { status: 200, cuerpo: { ok: true, gratis: false, desglose: c.desglose } };
		return {
			status: 200,
			cuerpo: {
				ok: true,
				gratis: c.montoCents === 0,
				desglose: c.desglose,
				referencia: `SA-REG3-${plan}-${cupon ?? 0}-1795398288-prueba`,
				amountInCents: c.montoCents,
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
				const estado = ${JSON.stringify(estado)};
				setTimeout(() => alTerminar(estado
					? { transaction: { id: 'tx-prueba', status: estado, reference: window.__wompi.config.reference } }
					: { transaction: null }), 50);
			}
		};`;
}

export { expect };

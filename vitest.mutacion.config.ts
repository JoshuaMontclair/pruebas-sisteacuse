import { defineConfig } from 'vitest/config';

// Configuración de Vitest para Stryker (pruebas de mutación): las mismas
// pruebas unitarias, sin las de caracterización de defectos conocidos (fijan un
// comportamiento equivocado a propósito) y sin reportes en disco.
export default defineConfig({
	test: {
		include: ['tests/unit/**/*.test.ts'],
		exclude: ['tests/unit/defectos.test.ts']
	}
});

import { describe, expect, it } from 'vitest';

import { resolveConfigurationText } from './configurationText';

describe('resolveConfigurationText', () => {
    it('localizes only the server-owned default and preserves administrator copy', () => {
        expect(resolveConfigurationText(undefined, 'Default', 'Predeterminado')).toBe('Predeterminado');
        expect(resolveConfigurationText('Default', 'Default', 'Predeterminado')).toBe('Predeterminado');
        expect(resolveConfigurationText('Equipo Norte', 'Default', 'Predeterminado')).toBe('Equipo Norte');
    });
});

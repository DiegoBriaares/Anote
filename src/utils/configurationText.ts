export const resolveConfigurationText = (
    configuredValue: string | undefined,
    storedDefault: string,
    localizedDefault: string
) => !configuredValue || configuredValue === storedDefault ? localizedDefault : configuredValue;

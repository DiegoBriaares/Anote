const fs = require('fs');

const POSIX_MODE_ENFORCEMENT = Object.freeze({
    REQUIRED: 'required',
    UNSUPPORTED: 'unsupported'
});

const UNSUPPORTED_MODE_ERROR_CODES = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP']);

const parsePosixModeEnforcement = (value = POSIX_MODE_ENFORCEMENT.REQUIRED) => {
    if (!Object.values(POSIX_MODE_ENFORCEMENT).includes(value)) {
        throw new Error('ANOTE_POSIX_MODE_ENFORCEMENT must be required or unsupported.');
    }
    return value;
};

/**
 * Apply a restrictive POSIX mode without confusing the container OS with the
 * host filesystem capability. Windows Docker bind mounts can reject chmod
 * even though their host ACLs remain the authority.
 */
const applyFileMode = (
    target,
    mode,
    enforcement = POSIX_MODE_ENFORCEMENT.REQUIRED,
    chmod = fs.chmodSync
) => {
    try {
        chmod(target, mode);
        return true;
    } catch (error) {
        if (
            enforcement === POSIX_MODE_ENFORCEMENT.UNSUPPORTED
            && UNSUPPORTED_MODE_ERROR_CODES.has(error?.code)
        ) {
            return false;
        }
        throw error;
    }
};

module.exports = {
    POSIX_MODE_ENFORCEMENT,
    applyFileMode,
    parsePosixModeEnforcement
};

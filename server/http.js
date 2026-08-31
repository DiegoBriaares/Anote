const crypto = require('crypto');

class ApiError extends Error {
    constructor(status, code, details) {
        super(code);
        this.name = 'ApiError';
        this.status = status;
        this.code = code.toUpperCase();
        this.details = details;
    }
}

const requestContext = (req, res, next) => {
    const inbound = req.get('x-request-id');
    req.requestId = typeof inbound === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(inbound)
        ? inbound
        : crypto.randomUUID();
    res.set('x-request-id', req.requestId);
    next();
};

const securityHeaders = (_req, res, next) => {
    res.set({
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    res.set('Cache-Control', 'no-store');
    next();
};

const canonicalHttpOrigin = (value) => {
    if (typeof value !== 'string' || !value || value.includes(',') || /\s/.test(value)) return null;
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)
            || parsed.username || parsed.password
            || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
        return parsed.origin;
    } catch {
        return null;
    }
};

const readExpectedOrigin = (req) => {
    const protocol = typeof req.protocol === 'string' ? req.protocol.toLowerCase() : '';
    const host = req.get('x-forwarded-host') || req.get('host');
    return canonicalHttpOrigin(`${protocol}://${host || ''}`);
};

const createSameOriginMutations = (allowedOrigins = []) => {
    const developmentOrigins = new Set(allowedOrigins.map(canonicalHttpOrigin).filter(Boolean));
    return (req, _res, next) => {
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
        const origin = canonicalHttpOrigin(req.get('origin'));
        const expectedOrigin = readExpectedOrigin(req);
        if (!origin || !expectedOrigin) {
            return next(new ApiError(403, 'origin_not_allowed'));
        }
        if (origin !== expectedOrigin && !developmentOrigins.has(origin)) {
            return next(new ApiError(403, 'origin_not_allowed'));
        }
        next();
    };
};

const notFound = (_req, _res, next) => next(new ApiError(404, 'route_not_found'));

const errorHandler = (error, req, res, _next) => {
    let apiError;
    if (error instanceof ApiError) {
        apiError = error;
    } else if (error?.type === 'entity.parse.failed') {
        apiError = new ApiError(400, 'invalid_json');
    } else if (error?.code === 'LIMIT_FILE_SIZE') {
        apiError = new ApiError(413, 'attachment_too_large');
    } else if (typeof error?.code === 'string' && error.code.startsWith('LIMIT_')) {
        apiError = new ApiError(400, 'invalid_attachment_request');
    } else {
        apiError = new ApiError(500, 'internal_error');
    }
    if (apiError.code === 'INTERNAL_ERROR') {
        console.error(`[${req.requestId}] Unhandled request error`, {
            name: typeof error?.name === 'string' ? error.name : 'Error',
            code: typeof error?.code === 'string' ? error.code : 'UNKNOWN'
        });
    }
    const payload = {
        error: {
            code: apiError.code
        },
        requestId: req.requestId
    };
    if (apiError.details !== undefined) payload.error.details = apiError.details;
    res.status(apiError.status).json(payload);
};

const createRateLimiter = ({ windowMs, maxAttempts, key }) => {
    const attempts = new Map();
    return (req, _res, next) => {
        const now = Date.now();
        const identity = key(req);
        const existing = attempts.get(identity);
        const entry = !existing || existing.resetAt <= now
            ? { count: 0, resetAt: now + windowMs }
            : existing;
        entry.count += 1;
        attempts.set(identity, entry);

        if (attempts.size > 5000) {
            for (const [candidate, value] of attempts) {
                if (value.resetAt <= now) attempts.delete(candidate);
            }
        }

        if (entry.count > maxAttempts) {
            return next(new ApiError(429, 'rate_limited', {
                retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
            }));
        }
        next();
    };
};

module.exports = {
    ApiError,
    canonicalHttpOrigin,
    createRateLimiter,
    createSameOriginMutations,
    errorHandler,
    notFound,
    requestContext,
    readExpectedOrigin,
    securityHeaders
};

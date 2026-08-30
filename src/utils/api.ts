// Compatibility exports for existing feature modules. Transport behavior lives
// in the API client so callers never need to know production ports or hosts.
export {
    API_ROOT as API_URL,
    normalizeApiAssetUrl,
    toApiUrl
} from '../api/client';

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = fs.readFileSync(path.resolve('scripts/deploy_to_prod.sh'), 'utf8');

describe('production deployment recovery contract', () => {
    it('uses a release-specific image tag so a same-commit deploy cannot replace the rollback image', () => {
        expect(script).toContain('ANOTE_DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"');
        expect(script).toContain('ANOTE_IMAGE_TAG="${ANOTE_SHORT_SHA}-${ANOTE_DEPLOY_ID}"');
        expect(script).not.toContain('ANOTE_IMAGE_TAG="$ANOTE_SHORT_SHA"');
    });

    it('saves data and the active runtime configuration before cutover', () => {
        const backup = script.indexOf('scripts/backup_production.sh');
        const activeEnvironmentCopy = script.indexOf('cp "$ANOTE_ENV_FILE" "$ANOTE_BACKUP_DIR/production.env"');
        const activateCandidate = script.indexOf('mv "$ANOTE_CANDIDATE_ENV" "$ANOTE_ENV_FILE"');
        const cutover = script.indexOf('up -d --remove-orphans');

        expect(backup).toBeGreaterThan(-1);
        expect(activeEnvironmentCopy).toBeGreaterThan(backup);
        expect(activateCandidate).toBeGreaterThan(activeEnvironmentCopy);
        expect(cutover).toBeGreaterThan(activateCandidate);
    });
});
